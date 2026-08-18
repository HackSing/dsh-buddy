const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 随包分发的 agent preset 目录(plugins/dsh-anchored-standard 之下),
// 源目录名 === 安装到 $DSH_HOME/.agent-presets/ 的目录名。
// 必须保持原名:zero-anchored-standard 与 whoami-standard 的 agent.cordis.yml
// 和 *.mjs 通过 ../preset/ 相对路径共享 preset/ 里的模块,改名即断链。
const BUNDLED_PLUGIN_DIR = 'dsh-anchored-standard';
const BUNDLED_PRESET_DIRS = ['preset', 'zero-anchored-standard', 'whoami-standard'];

// 上次安装内容的 sha256 指纹,放在 presetsRoot 下的点号文件里:
// 不匹配 dsh 的 preset id 规则([a-z0-9][a-z0-9-]*),不会被发现机制误认。
const FINGERPRINT_FILE = '.bundled-fingerprint.json';

// dsh 的 preset 根目录约定:$DSH_HOME 缺省为 ~/.dsh(与插件 README 的安装脚本一致)
function defaultDshHome(env, homeDir) {
  return env.DSH_HOME || path.join(homeDir, '.dsh');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 递归列出目录内全部文件的相对路径(统一正斜杠,跨平台指纹稳定)。
function listFiles(dir, prefix = '', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(path.join(dir, entry.name), rel, out);
    else out.push(rel);
  }
  return out;
}

// 指纹文件缺失或损坏都按"无指纹"处理:无法证明用户没动过,逐文件保守保留。
function loadFingerprint(presetsRoot) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(presetsRoot, FINGERPRINT_FILE), 'utf8'));
    if (data && typeof data === 'object' && data.files && typeof data.files === 'object') return data;
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[dsh-buddy] bundled preset fingerprint unreadable, treating as absent: ${err.message}`);
    return null;
  }
}

// 先写 staging 再 rename,进程中断不会留下半个指纹文件。
function writeFingerprint(presetsRoot, fingerprint) {
  const file = path.join(presetsRoot, FINGERPRINT_FILE);
  const staging = `${file}.installing`;
  fs.writeFileSync(staging, JSON.stringify(fingerprint, null, 2));
  fs.renameSync(staging, file);
}

// 全新安装单个 preset 目录;目标已存在则返回 null 交 syncOne 走升级路径。
// 先拷到 staging 再 rename:进程中断只会留下点号开头的 staging 目录,
// 它不匹配 dsh 的 preset id 规则([a-z0-9][a-z0-9-]*),不会被发现机制误认。
function installOne(srcDir, presetsRoot, name) {
  const dest = path.join(presetsRoot, name);
  if (fs.existsSync(dest)) return null;

  const staging = path.join(presetsRoot, `.${name}.installing`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(srcDir, staging, { recursive: true });
  fs.renameSync(staging, dest);
  return listFiles(dest);
}

// 已存在目录的逐文件三路比对(指纹 = 上次安装时随包内容的哈希):
// - 用户没动过(内容 == 旧指纹) → 直接更新为新的随包内容;
// - 用户改过(内容 != 旧指纹,或旧指纹缺失且与新随包不同) → 保留,记入 preserved;
// - 随包新增或用户删掉的文件 → 直接落地;
// - 内容已与随包一致(用户手动同步过) → 只刷新指纹,不算更新也不算保留。
// preserved 只在"随包有更新但被本地修改挡住"时产生,按随包版本去重:
// 同一版更新只通知一次,用户故意分叉但随包没变不打扰。
function syncOne(srcDir, presetsRoot, name, oldFiles, newFiles, summary) {
  const dest = path.join(presetsRoot, name);
  for (const rel of listFiles(srcDir)) {
    const key = `${name}/${rel}`;
    const srcPath = path.join(srcDir, rel);
    const srcContent = fs.readFileSync(srcPath);
    const srcHash = sha256(srcContent);
    const oldHash = oldFiles ? oldFiles[key] : undefined;
    const destPath = path.join(dest, rel);

    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      newFiles[key] = srcHash;
      summary.updated.push(key);
      continue;
    }

    const destHash = sha256(fs.readFileSync(destPath));
    if (destHash === srcHash) {
      // 已与随包一致(含用户手动同步过的情况):只刷新指纹。
      newFiles[key] = srcHash;
      continue;
    }
    if (oldHash === undefined || destHash !== oldHash) {
      // 用户改过,或旧指纹缺失(旧版安装)无法证明用户没动过:保守保留。
      // 指纹记录最新随包哈希而非旧基线:用户按通知手动同步成随包版后,
      // 内容匹配指纹即自动回到更新轨道;通知按随包版本去重,同一版只提醒一次。
      newFiles[key] = srcHash;
      if (srcHash !== oldHash) summary.preserved.push(key);
      continue;
    }
    // 用户没动过(内容 == 旧指纹):更新为新的随包内容。
    fs.copyFileSync(srcPath, destPath);
    newFiles[key] = srcHash;
    summary.updated.push(key);
  }
}

// 把随包 preset 安装/升级到 dshHome 的 .agent-presets 下。
// pluginsRoot 指向随包 plugins 目录(开发态/打包态的差异由调用方解析)。
// 随包资产缺失说明分发损坏,直接抛错交调用方呈现。
// 返回 { installed, updated, preserved }:preserved 非空说明有更新被本地修改挡住,
// 调用方应告知用户(用户备份后删掉对应文件,下次启动即重新落地随包版)。
function installBundledPresets({ pluginsRoot, dshHome, version = 'unknown' }) {
  const presetsRoot = path.join(dshHome, '.agent-presets');
  fs.mkdirSync(presetsRoot, { recursive: true });

  const oldFingerprint = loadFingerprint(presetsRoot);
  const oldFiles = oldFingerprint ? oldFingerprint.files : null;
  const summary = { installed: [], updated: [], preserved: [] };
  const newFiles = {};

  for (const name of BUNDLED_PRESET_DIRS) {
    const srcDir = path.join(pluginsRoot, BUNDLED_PLUGIN_DIR, name);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`bundled preset missing: ${srcDir}`);
    }
    const installed = installOne(srcDir, presetsRoot, name);
    if (installed) {
      for (const rel of installed) {
        newFiles[`${name}/${rel}`] = sha256(fs.readFileSync(path.join(srcDir, rel)));
      }
      summary.installed.push(name);
    } else {
      syncOne(srcDir, presetsRoot, name, oldFiles, newFiles, summary);
    }
  }

  writeFingerprint(presetsRoot, { version, files: newFiles });
  return summary;
}

module.exports = { installBundledPresets, defaultDshHome };
