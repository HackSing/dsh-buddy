const fs = require('fs');
const path = require('path');
const tar = require('tar');

// 把随包分发的 web profile tar(构建机由 scripts/build-web-profile.js 产出)
// 幂等解包到 dshHome/profiles/<profileName>:
// - tar 资源不存在 → 开发态正常状态,返回 'no-tarball' 不算错误;
// - 目标 profile 已存在 → 跳过,尊重用户已有环境(不合并不覆盖);
// - 解包走 staging 再 rename,进程中断只留点号开头的 staging 目录。
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

function installBundledProfile({ tarballPath, dshHome, profileName }) {
  if (!fs.existsSync(tarballPath)) return 'no-tarball';

  const profilesRoot = path.join(dshHome, 'profiles');
  const dest = path.join(profilesRoot, profileName);
  if (fs.existsSync(dest)) return 'skipped';

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

    fs.renameSync(path.join(staging, profileName), dest);
    return 'installed';
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { installBundledProfile };
