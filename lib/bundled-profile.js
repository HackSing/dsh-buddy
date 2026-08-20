const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { parseVersion, isNewerVersion } = require('./update-check');

// 把随包分发的 web profile tar(构建机由 scripts/build-web-profile.js 产出)
// 安装到 dshHome/profiles/<profileName>,返回 { status, ... }:
// - tar 资源不存在 → 'no-tarball',开发态正常状态,不算错误;
// - 目标 profile 不存在 → 'installed';
// - 已存在且 dependencies 全部不落后于清单(一致,或运行时热更领先于随包清单)
//   → 'up-to-date',不动磁盘;
// - 已存在、版本落后或缺包且无清单外依赖 → 旧目录备份后整体替换,'upgraded';
// - 已存在但含清单外依赖(或 package.json 不可读) → 'preserved',原样保留并给出包名。
// 解包走 staging 再 rename,进程中断只留点号开头的 staging 目录;
// 升级路径先解包成功再动旧目录,rename 原子替换,失败回滚到旧目录。
//
// 解包不再走系统 bsdtar:Windows 普通用户默认无创建符号链接的特权,bsdtar
// 解包 pnpm 布局的 symlink 条目会失败。改为纯 Node 两遍解包——
// 第一遍只落实体文件/目录,第二遍处理链接条目:
// - win32:symlink 实体化复制(fs.cpSync dereference 跟随整条链接链),无需任何特权;
// - POSIX:fs.symlinkSync / fs.linkSync,与 bsdtar 行为一致。
// 两遍都读取本地文件流,秒级成本可接受。

// 链接目标解析后必须仍在解包根内:绝对路径(如 Windows junction 指向 pnpm
// store)或越界相对路径都可能在终端用户机器上不存在或指向外部,一律拒绝。
function assertWithin(root, resolved, what) {
  const rootNorm = path.resolve(root).toLowerCase();
  const resNorm = path.resolve(resolved).toLowerCase();
  if (resNorm !== rootNorm && !resNorm.startsWith(rootNorm + path.sep)) {
    throw new Error(`${what} escapes staging root: ${resolved}`);
  }
}

// 第一遍:只读 tar 元数据,收集链接条目(实体由第二遍落盘)。
// 链接语义与 GNU tar 一致:symlink 的 linkpath 相对条目所在目录,
// hardlink 的 linkpath 相对 tar 根。
function collectLinks(tarballPath) {
  const links = [];
  tar.t({
    file: tarballPath,
    sync: true,
    onReadEntry: (entry) => {
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        links.push({ path: entry.path, type: entry.type, linkpath: entry.linkpath || '' });
      }
    },
  });
  return links;
}

// 第二遍:实体已全部落盘后处理链接。
function applyLinks(staging, links) {
  for (const link of links) {
    const dest = path.join(staging, link.path);
    if (link.type === 'SymbolicLink') {
      const target = path.resolve(staging, path.dirname(link.path), link.linkpath);
      assertWithin(staging, target, 'symlink target');
      if (process.platform === 'win32') {
        // 实体化复制:dereference 跟随任意深度的链接链,最终落到第一遍的实体
        fs.cpSync(target, dest, { recursive: true, dereference: true });
      } else {
        fs.symlinkSync(link.linkpath, dest);
      }
    } else {
      // Link(hardlink):linkpath 相对 tar 根
      const target = path.resolve(staging, link.linkpath);
      assertWithin(staging, target, 'hardlink target');
      try {
        fs.linkSync(target, dest);
      } catch (err) {
        // 跨卷/权限等场景降级为复制:链接语义不成立,但文件内容完整
        fs.cpSync(target, dest, { recursive: true, dereference: true });
      }
    }
  }
}

// 升级判定(纯函数,供单测):只信 profile package.json 的 dependencies。
// deps 为 null(package.json 缺失/不可读)或含清单外条目时一律 preserved——
// 无法证明替换安全,宁可保留也不覆盖用户环境。
// 比较带方向:profile 版本不低于清单(含运行时热更领先于随包清单的情形)即视为
// 满足,不做替换;只有落后、缺包或版本不可解析才判定 upgrade——否则热更到新版
// 的 profile 会被随包旧清单回滚。
function profileSatisfiesManifest(profileVersion, manifestVersion) {
  if (!parseVersion(profileVersion) || !parseVersion(manifestVersion)) return false;
  return !isNewerVersion(manifestVersion, profileVersion);
}

function profileUpgradeDecision(deps, manifestPackages) {
  if (!deps || typeof deps !== 'object') return { status: 'preserved', extras: [] };
  const manifest = new Map(manifestPackages.map((p) => [p.name, p.version]));
  const extras = Object.keys(deps).filter((name) => !manifest.has(name)).sort();
  if (extras.length > 0) return { status: 'preserved', extras };
  const stale = manifestPackages.some((p) => !profileSatisfiesManifest(deps[p.name], p.version));
  return { status: stale ? 'upgrade' : 'up-to-date' };
}

function readProfileDeps(profileDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    return pkg && typeof pkg.dependencies === 'object' ? pkg.dependencies : null;
  } catch {
    return null;
  }
}

// 备份目录名带旧 profile 的版本标识(取首个命中的清单包版本),同名复用不累积。
function backupDirName(profileName, deps, manifestPackages) {
  const hit = manifestPackages.find((p) => deps && typeof deps[p.name] === 'string');
  const tag = hit ? deps[hit.name] : 'unknown';
  return `${profileName}.backup-${String(tag).replace(/[^0-9A-Za-z._-]/g, '_')}`;
}

function installBundledProfile({ tarballPath, dshHome, profileName, manifestPackages = [] }) {
  if (!fs.existsSync(tarballPath)) return { status: 'no-tarball' };

  const profilesRoot = path.join(dshHome, 'profiles');
  const dest = path.join(profilesRoot, profileName);
  const freshInstall = !fs.existsSync(dest);
  let existingDeps = null;
  if (!freshInstall) {
    existingDeps = readProfileDeps(dest);
    const decision = profileUpgradeDecision(existingDeps, manifestPackages);
    if (decision.status === 'up-to-date') return { status: 'up-to-date' };
    if (decision.status === 'preserved') return { status: 'preserved', extras: decision.extras };
  }

  fs.mkdirSync(profilesRoot, { recursive: true });
  const staging = path.join(profilesRoot, `.${profileName}.installing`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging);

  try {
    const links = collectLinks(tarballPath);

    // 实体条目由 tar.x 落盘(mode/mtime 一并保留),链接条目在第二遍处理;
    // 设备/FIFO 等罕见类型不支持,跳过并留痕,不让安装卡死。
    tar.x({
      file: tarballPath,
      cwd: staging,
      sync: true,
      filter: (entryPath, entry) => {
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') return false;
        if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'Directory') {
          console.warn(`[bundled-profile] skip unsupported entry type: ${entry.type} ${entryPath}`);
          return false;
        }
        return true;
      },
    });

    applyLinks(staging, links);

    const staged = path.join(staging, profileName);
    if (freshInstall) {
      fs.renameSync(staged, dest);
      return { status: 'installed' };
    }
    // 升级:先整目录备份旧 profile,再把 staging 结果换入;换入失败回滚旧目录。
    const backupName = backupDirName(profileName, existingDeps, manifestPackages);
    const backup = path.join(profilesRoot, backupName);
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(dest, backup);
    try {
      fs.renameSync(staged, dest);
    } catch (err) {
      fs.renameSync(backup, dest);
      throw err;
    }
    return { status: 'upgraded', backup: backupName };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { installBundledProfile, profileUpgradeDecision, readProfileDeps };
