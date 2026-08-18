import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installBundledPresets } = require('../lib/bundled-presets.js');

const PRESET_DIRS = ['preset', 'zero-anchored-standard', 'whoami-standard'];
const FINGERPRINT = '.bundled-fingerprint.json';

// 搭一个最小随包 pluginsRoot 和空 dshHome;returns { pluginsRoot, dshHome, presetsRoot }。
// files 形如 { 'preset/agent.cordis.yml': '...' },未列出的目录给默认单文件。
function scaffold(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-presets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pluginsRoot = path.join(root, 'plugins');
  const dshHome = path.join(root, 'dsh-home');
  for (const dir of PRESET_DIRS) {
    const key = `${dir}/agent.cordis.yml`;
    write(pluginsRoot, 'dsh-anchored-standard', key, files[key] ?? `${dir} bundled v1`);
  }
  for (const [key, content] of Object.entries(files)) {
    if (!key.endsWith('agent.cordis.yml')) write(pluginsRoot, 'dsh-anchored-standard', key, content);
  }
  return { pluginsRoot, dshHome, presetsRoot: path.join(dshHome, '.agent-presets') };
}

function write(...segments) {
  const content = segments.pop();
  const file = path.join(...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

test('fresh install copies all presets and writes a fingerprint', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  const summary = installBundledPresets({ pluginsRoot, dshHome, version: '0.1.0' });
  assert.deepEqual(summary.installed.sort(), [...PRESET_DIRS].sort());
  assert.deepEqual(summary.updated, []);
  assert.deepEqual(summary.preserved, []);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'preset bundled v1');
  const fp = JSON.parse(read(presetsRoot, FINGERPRINT));
  assert.equal(fp.version, '0.1.0');
  assert.equal(Object.keys(fp.files).length, 3);
});

test('a second run with unchanged bundled content is a no-op', (t) => {
  const { pluginsRoot, dshHome } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary, { installed: [], updated: [], preserved: [] });
});

test('bundled updates apply when the user never touched the file', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v2');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.updated, ['preset/agent.cordis.yml']);
  assert.deepEqual(summary.preserved, []);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'preset bundled v2');
});

test('a user-modified file is preserved when bundled content changes', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(presetsRoot, 'preset', 'agent.cordis.yml', 'user bashPath edit');
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v2');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.preserved, ['preset/agent.cordis.yml']);
  assert.deepEqual(summary.updated, []);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'user bashPath edit');
  // 同一随包版本只通知一次:再次运行保留用户文件但不再重复打扰。
  const again = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(again.preserved, []);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'user bashPath edit');
});

test('a user modification without a bundled change is kept silently', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(presetsRoot, 'preset', 'agent.cordis.yml', 'user bashPath edit');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary, { installed: [], updated: [], preserved: [] });
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'user bashPath edit');
});

test('a legacy install without fingerprint is preserved wholesale, never overwritten', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  fs.rmSync(path.join(presetsRoot, FINGERPRINT)); // 模拟指纹机制引入前的旧安装
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v2');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.updated, []);
  assert.deepEqual(summary.preserved, ['preset/agent.cordis.yml']);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'preset bundled v1');
});

test('a corrupt fingerprint file falls back to preserve-everything', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(presetsRoot, FINGERPRINT, '{ not json');
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v2');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.preserved, ['preset/agent.cordis.yml']);
  assert.deepEqual(summary.updated, []);
  // 损坏的指纹被重写为合法指纹,下次启动恢复正常比对。
  const fp = JSON.parse(read(presetsRoot, FINGERPRINT));
  assert.equal(typeof fp.files, 'object');
});

test('new bundled files land in existing installs', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/tool-bootstrap.mjs', 'export {}');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.updated, ['preset/tool-bootstrap.mjs']);
  assert.equal(read(presetsRoot, 'preset', 'tool-bootstrap.mjs'), 'export {}');
});

test('a file the user deleted is restored from the bundle', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  fs.rmSync(path.join(presetsRoot, 'preset', 'agent.cordis.yml'));
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.updated, ['preset/agent.cordis.yml']);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'preset bundled v1');
});

test('a file the user manually synced to the new bundle rejoins the update track', (t) => {
  const { pluginsRoot, dshHome, presetsRoot } = scaffold(t);
  installBundledPresets({ pluginsRoot, dshHome });
  write(presetsRoot, 'preset', 'agent.cordis.yml', 'user bashPath edit');
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v2');
  installBundledPresets({ pluginsRoot, dshHome }); // preserved
  // 用户按通知手动同步成随包新版。
  write(presetsRoot, 'preset', 'agent.cordis.yml', 'preset bundled v2');
  write(pluginsRoot, 'dsh-anchored-standard', 'preset/agent.cordis.yml', 'preset bundled v3');
  const summary = installBundledPresets({ pluginsRoot, dshHome });
  assert.deepEqual(summary.updated, ['preset/agent.cordis.yml']);
  assert.deepEqual(summary.preserved, []);
  assert.equal(read(presetsRoot, 'preset', 'agent.cordis.yml'), 'preset bundled v3');
});
