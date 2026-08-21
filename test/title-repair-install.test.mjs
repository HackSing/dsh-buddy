import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installTitleRepair, PLUGIN_DIR } = require('../lib/title-repair-install.js');

const REAL_PLUGINS_ROOT = path.join(import.meta.dirname, '..', 'plugins');

// 搭一个临时 profileDir;pluginsRoot 默认用仓库里真实的 plugins 目录
// (插件本体只有 2 个小文件,直接拿真身测同步),也可传 stub 覆盖。
function scaffold(t, { pluginFiles } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'title-repair-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let pluginsRoot = REAL_PLUGINS_ROOT;
  if (pluginFiles) {
    pluginsRoot = path.join(root, 'plugins');
    for (const [rel, content] of Object.entries(pluginFiles)) {
      const file = path.join(pluginsRoot, PLUGIN_DIR, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  return { pluginsRoot, profileDir: path.join(root, 'profile') };
}

function destFile(profileDir, rel) {
  return path.join(profileDir, 'node_modules', PLUGIN_DIR, rel);
}

test('fresh install copies the plugin and creates the patch layer', (t) => {
  const { pluginsRoot, profileDir } = scaffold(t);
  const summary = installTitleRepair({ pluginsRoot, profileDir });
  assert.deepEqual(summary, { plugin: 'installed', patch: 'applied' });
  assert.equal(
    fs.readFileSync(destFile(profileDir, 'index.js'), 'utf8'),
    fs.readFileSync(path.join(REAL_PLUGINS_ROOT, PLUGIN_DIR, 'index.js'), 'utf8')
  );
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:\n {4}- id: dsh-buddy-title-repair\n {6}name: dsh-buddy-title-repair/);
});

test('a second run with unchanged content is a no-op', (t) => {
  const { pluginsRoot, profileDir } = scaffold(t);
  installTitleRepair({ pluginsRoot, profileDir });
  const summary = installTitleRepair({ pluginsRoot, profileDir });
  assert.deepEqual(summary, { plugin: 'current', patch: 'already' });
  // 幂等不是「没写文件」而是「内容仍只有一条挂载行」
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.equal(patch.match(/dsh-buddy-title-repair/g).length, 2); // id 行 + name 行
});

test('changed bundled content overwrites the installed copy', (t) => {
  const { pluginsRoot, profileDir } = scaffold(t, {
    pluginFiles: { 'package.json': '{"name":"x"}', 'index.js': 'v1' },
  });
  installTitleRepair({ pluginsRoot, profileDir });
  fs.writeFileSync(path.join(pluginsRoot, PLUGIN_DIR, 'index.js'), 'v2');
  const summary = installTitleRepair({ pluginsRoot, profileDir });
  assert.equal(summary.plugin, 'updated');
  assert.equal(fs.readFileSync(destFile(profileDir, 'index.js'), 'utf8'), 'v2');
});

test('patch row is appended to an existing non-empty patch layer', (t) => {
  const { pluginsRoot, profileDir } = scaffold(t);
  fs.mkdirSync(profileDir, { recursive: true });
  const existing = '# header\n- insert:\n    - id: dsh-buddy-about\n      name: dsh-buddy-about\n';
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), existing);
  const summary = installTitleRepair({ pluginsRoot, profileDir });
  assert.equal(summary.patch, 'applied');
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.startsWith(existing.trimEnd()), '既有内容原样保留');
  assert.match(patch, /dsh-buddy-about/);
  assert.match(patch, /- insert:\n {4}- id: dsh-buddy-title-repair/);
});

test("patch row replaces dsh's empty [] layer", (t) => {
  const { pluginsRoot, profileDir } = scaffold(t);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '# header line\n[]\n');
  const summary = installTitleRepair({ pluginsRoot, profileDir });
  assert.equal(summary.patch, 'applied');
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.ok(!patch.includes('[]'));
  assert.match(patch, /- insert:\n {4}- id: dsh-buddy-title-repair/);
});

test('an unrecognizable patch layer is refused, not rewritten', (t) => {
  const { pluginsRoot, profileDir } = scaffold(t);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), 'just: a map\n');
  assert.throws(() => installTitleRepair({ pluginsRoot, profileDir }), /拒绝自动改写/);
});

test('missing bundled plugin is a distribution defect and throws', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'title-repair-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => installTitleRepair({ pluginsRoot: path.join(root, 'nope'), profileDir: path.join(root, 'p') }),
    /title-repair plugin missing/
  );
});
