const fs = require('fs');
const path = require('path');

// 从包目录读取 bin 字段,拿到真实入口脚本(不猜路径)。
// 主进程(解析随包内嵌的 dsh)与追新兼容验证脚本(解析临时工作区里刚装的新版 dsh)
// 共用这一份规则:上游若改动 bin 字段形态,两处同时跟随,不会出现
// 「壳起不来但 CI 说兼容」的分裂结论。
//
// 目录不存在、manifest 不可读、bin 缺失、入口文件不存在 → 返回 null。
// 这不是吞错误:调用方对 null 的处置本就不同(主进程要继续试下一个候选目录,
// 验证脚本要判定为失败),解析层不替调用方做决定。
function binEntryFrom(pkgDir) {
  const manifest = path.join(pkgDir, 'package.json');
  let bin;
  try {
    bin = JSON.parse(fs.readFileSync(manifest, 'utf8')).bin;
  } catch (_) {
    return null;
  }
  const rel = typeof bin === 'string' ? bin : bin && (bin.dsh || Object.values(bin)[0]);
  if (!rel) return null;
  const entry = path.join(pkgDir, rel);
  return fs.existsSync(entry) ? entry : null;
}

module.exports = { binEntryFrom };
