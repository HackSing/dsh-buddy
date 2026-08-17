const fs = require('fs');
const path = require('path');
const { defaultDshHome } = require('./bundled-presets');

// 壳界面语言的单一来源:$DSH_HOME/settings.yaml 的 locale.preference
// (dsh 自身的语言配置,壳菜单跟随它,不写死)。
// settings.yaml 是 dsh 写出的扁平 YAML,这里只取一行标量,不引入 YAML 依赖;
// 文件不存在/字段缺失(全新机器、旧版本 dsh)是可预期状态,回退默认语言。
const DEFAULT_LOCALE = 'en';

// 返回原始 preference 字符串(如 'zh'、'en'),调用方自行判断语族。
function readLocalePreference(env, homeDir) {
  const file = path.join(defaultDshHome(env, homeDir), 'settings.yaml');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return DEFAULT_LOCALE;
  }
  const match = raw.match(/^\s*preference:\s*['"]?([A-Za-z-]+)['"]?\s*$/m);
  return match ? match[1] : DEFAULT_LOCALE;
}

// 壳菜单目前只有中/英两套文案:zh*(zh、zh-CN、zh-Hans)归中文,其余归英文。
function resolveMenuLocale(env, homeDir) {
  return readLocalePreference(env, homeDir).toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

module.exports = { readLocalePreference, resolveMenuLocale, DEFAULT_LOCALE };
