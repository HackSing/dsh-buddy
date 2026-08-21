const fs = require('fs');
const path = require('path');

// 会话标题修复插件的 profile 安装器。
//
// 插件本体在 plugins/dsh-buddy-title-repair(host 半插件,启动时把缺失的
// 会话标题从日志重折回投影缓存,详见插件内注释)。要让 dsh 挂上它需要两样:
// 1. 包落在 profile 的 node_modules 下(loader 按包名解析,与 dsh-buddy-about 同款);
// 2. profile 的 cordis.patch.yml 里有一条 insert 挂载行。
// 两者都是幂等的:每次应用启动都重装/补齐——profile 升级(bundle 整体换新)
// 会把 node_modules 与 patch 层冲掉,靠这个每启重装自愈。

const PLUGIN_DIR = 'dsh-buddy-title-repair';

// 插件对外只由这两个文件组成;增减文件时同步更新此处。
const PLUGIN_FILES = ['package.json', 'index.js'];

// patch 层挂载行(含说明注释)。marker 判定用包名子串,见 ensurePatchRow。
const PATCH_ENTRY = [
  '# dsh-buddy: 会话标题修复插件(启动时回写投影缓存;由壳幂等维护,勿删)',
  '- insert:',
  '    - id: dsh-buddy-title-repair',
  '      name: dsh-buddy-title-repair',
].join('\n');

// dsh 未初始化 profile 时连 patch 层文件都没有,预建一个只含本行。
const PATCH_FILE_HEADER = '# Your patch layer for this dsh profile, applied after every bundle layer:\n';

// 同步插件包到 profile node_modules。目标目录由壳独占管理(私有包名,
// 用户没有手工编辑的合理场景),内容不一致直接覆盖,不做三路保留。
// 返回 'installed' | 'updated' | 'current'。
function syncPluginPackage(srcDir, profileDir) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`bundled title-repair plugin missing: ${srcDir}`);
  }
  const destDir = path.join(profileDir, 'node_modules', PLUGIN_DIR);
  const existed = fs.existsSync(destDir);
  let changed = false;
  for (const rel of PLUGIN_FILES) {
    const src = fs.readFileSync(path.join(srcDir, rel));
    const dest = path.join(destDir, rel);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, src);
      changed = true;
    }
  }
  if (!changed) return 'current';
  return existed ? 'updated' : 'installed';
}

// 确保 patch 层有本插件的挂载行。返回 'applied' | 'already'。
// 不解析 YAML:只识别三种形状——已含本行(幂等短路)、dsh 初始化的空层 '[]'、
// 顶层数组(直接在末尾追加一条独立 insert 项;loader 对多条 insert 顺序合并,
// 见 cordis-plugin-include 的 applyEntryPatches)。其它形状拒绝改写,交人处理。
function ensurePatchRow(profileDir) {
  const file = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(file, PATCH_FILE_HEADER + PATCH_ENTRY + '\n');
    return 'applied';
  }
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(PLUGIN_DIR)) return 'already';
  const body = source
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim();
  if (body === '[]') {
    fs.writeFileSync(file, source.replace('[]', PATCH_ENTRY));
    return 'applied';
  }
  if (body.startsWith('-')) {
    fs.writeFileSync(file, source.trimEnd() + '\n' + PATCH_ENTRY + '\n');
    return 'applied';
  }
  throw new Error(`patch 层形状无法识别,拒绝自动改写,请手工合并:${file}`);
}

// 入口:装包 + 补挂载行。profile 目录不存在(profile 未初始化)同样可用——
// dsh 首启按 cordis.patch.yml 已存在即采纳。返回 { plugin, patch }。
function installTitleRepair({ pluginsRoot, profileDir }) {
  const plugin = syncPluginPackage(path.join(pluginsRoot, PLUGIN_DIR), profileDir);
  const patch = ensurePatchRow(profileDir);
  return { plugin, patch };
}

module.exports = { installTitleRepair, PLUGIN_DIR };
