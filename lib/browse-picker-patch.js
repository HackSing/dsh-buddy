const fs = require('fs');
const path = require('path');

// dsh profile 的 patch 层写入:把目录选择钉死在 dsh 自带的 browse 交互上。
//
// 用途是降级——内嵌 dsh 的原生 Win32 目录选择器跑在本壳的 Electron 运行时里,
// 上游 worker 用 koffi.view()(external ArrayBuffer)读对话框返回的路径,而 Electron
// 禁用该能力,调用即崩(详见 scripts/patch-dsh-picker.js)。默认路径是给上游产物打补丁,
// 补丁失效时用本模块换掉后端:browse 在网页内选目录,完全不碰原生对话框与 koffi。
//
// 上游 @deepseek-ai/dsh-web-app/cordis.patch.yml 的 directory-picker 行注释里
// 写明「Mount -native or -browse directly in an overlay to pin the interaction」,
// 本模块就是那个 overlay:禁掉 auto 行,再插入 browse 的后端与客户端两张面
// (auto 插件同时挂载 BACKEND_PACKAGES 与 SURFACE_PACKAGES,pin 时两者都要自己给)。

/** patch 文件里本块的幂等标记,只出现在本模块写入的文本中。 */
const MARKER = '# dsh-buddy: browse-picker 降级层';

/** 未写入任何 patch 时 dsh 初始化出的空 patch 层内容。 */
const EMPTY_PATCH = '[]';

const PATCH_BLOCK = [
  MARKER + '(由 scripts/use-browse-picker.js 写入,--revert 移除)',
  '# 原生目录选择器在 Electron 运行时下不可用时的退路:网页内选目录,不弹系统对话框。',
  '- id: directory-picker',
  '  disabled: true',
  '- insert:',
  '    - id: directory-picker-browse',
  "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
  '    - id: directory-picker-browse-ui',
  "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
].join('\n');

/** profile 的 patch 层文件路径(dsh 约定的文件名)。 */
function patchPath(profileDir) {
  return path.join(profileDir, 'cordis.patch.yml');
}

// 判定当前 patch 层处于哪种状态。'custom' = 用户或其它工具写过别的行:
// 此时不动它,由调用方报错交人处理,避免机器合并 YAML 把别人的配置改坏。
function classify(source) {
  if (source.includes(MARKER)) return 'patched';
  const body = source
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim();
  return body === EMPTY_PATCH ? 'empty' : 'custom';
}

/** 读取 patch 层状态:'patched' | 'empty' | 'custom' | 'missing'。 */
function statusOf(profileDir) {
  const file = patchPath(profileDir);
  if (!fs.existsSync(file)) return 'missing';
  return classify(fs.readFileSync(file, 'utf8'));
}

// 写入降级块:保留文件原有的注释头(dsh 自己生成的说明),只把空数组换成本块。
function applyBrowsePicker(profileDir) {
  const file = patchPath(profileDir);
  const status = statusOf(profileDir);
  if (status === 'patched') return 'already';
  if (status === 'missing') throw new Error(`patch 层不存在(profile 未初始化?):${file}`);
  if (status === 'custom') {
    throw new Error(`patch 层已有自定义内容,拒绝自动改写,请手工合并:${file}`);
  }
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, source.replace(EMPTY_PATCH, PATCH_BLOCK));
  return 'applied';
}

// 撤销:把本块换回空数组,回到 auto 解析(win32 上即原生对话框)。
function revertBrowsePicker(profileDir) {
  const file = patchPath(profileDir);
  if (statusOf(profileDir) !== 'patched') return 'absent';
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, source.replace(PATCH_BLOCK, EMPTY_PATCH));
  return 'reverted';
}

module.exports = { MARKER, PATCH_BLOCK, patchPath, statusOf, applyBrowsePicker, revertBrowsePicker };
