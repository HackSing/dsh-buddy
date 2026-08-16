const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 把随包分发的 web profile tar(构建机由 scripts/build-web-profile.js 产出)
// 幂等解包到 dshHome/profiles/<profileName>:
// - tar 资源不存在 → 开发态正常状态,返回 'no-tarball' 不算错误;
// - 目标 profile 已存在 → 跳过,尊重用户已有环境(不合并不覆盖);
// - 解包走 staging 再 rename,进程中断只留点号开头的 staging 目录。
function installBundledProfile({ tarballPath, dshHome, profileName }) {
  if (!fs.existsSync(tarballPath)) return 'no-tarball';

  const profilesRoot = path.join(dshHome, 'profiles');
  const dest = path.join(profilesRoot, profileName);
  if (fs.existsSync(dest)) return 'skipped';

  fs.mkdirSync(profilesRoot, { recursive: true });
  const staging = path.join(profilesRoot, `.${profileName}.installing`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging);

  const r = spawnSync('tar', ['-xzf', tarballPath, '-C', staging], { encoding: 'utf8' });
  if (r.status !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`tar extract failed (${r.status}): ${(r.stderr || '').trim()}`);
  }

  fs.renameSync(path.join(staging, profileName), dest);
  fs.rmSync(staging, { recursive: true, force: true });
  return 'installed';
}

module.exports = { installBundledProfile };
