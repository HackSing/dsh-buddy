const fs = require('fs');
const path = require('path');

// 随包分发的 agent preset 目录(plugins/dsh-anchored-standard 之下),
// 源目录名 === 安装到 $DSH_HOME/.agent-presets/ 的目录名。
// 必须保持原名:zero-anchored-standard 与 whoami-standard 的 agent.cordis.yml
// 和 *.mjs 通过 ../preset/ 相对路径共享 preset/ 里的模块,改名即断链。
const BUNDLED_PLUGIN_DIR = 'dsh-anchored-standard';
const BUNDLED_PRESET_DIRS = ['preset', 'zero-anchored-standard', 'whoami-standard'];

// dsh 的 preset 根目录约定:$DSH_HOME 缺省为 ~/.dsh(与插件 README 的安装脚本一致)
function defaultDshHome(env, homeDir) {
  return env.DSH_HOME || path.join(homeDir, '.dsh');
}

// 把单个 preset 目录装到 presetsRoot 下;目标已存在则跳过(尊重用户本地修改)。
// 先拷到 staging 再 rename:进程中断只会留下点号开头的 staging 目录,
// 它不匹配 dsh 的 preset id 规则([a-z0-9][a-z0-9-]*),不会被发现机制误认。
function installOne(srcDir, presetsRoot, name) {
  const dest = path.join(presetsRoot, name);
  if (fs.existsSync(dest)) return 'skipped';

  const staging = path.join(presetsRoot, `.${name}.installing`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(srcDir, staging, { recursive: true });
  fs.renameSync(staging, dest);
  return 'installed';
}

// 把随包 preset 幂等安装到 dshHome 的 .agent-presets 下。
// pluginsRoot 指向随包 plugins 目录(开发态/打包态的差异由调用方解析)。
// 随包资产缺失说明分发损坏,直接抛错交调用方呈现。
function installBundledPresets({ pluginsRoot, dshHome }) {
  const presetsRoot = path.join(dshHome, '.agent-presets');
  fs.mkdirSync(presetsRoot, { recursive: true });

  const summary = { installed: [], skipped: [] };
  for (const name of BUNDLED_PRESET_DIRS) {
    const srcDir = path.join(pluginsRoot, BUNDLED_PLUGIN_DIR, name);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`bundled preset missing: ${srcDir}`);
    }
    summary[installOne(srcDir, presetsRoot, name)].push(name);
  }
  return summary;
}

module.exports = { installBundledPresets, defaultDshHome };
