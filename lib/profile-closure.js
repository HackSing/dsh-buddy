const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

// profile 依赖闭包与外科替换的集合运算,发布侧(scripts/build-plugin-channel.js
// 切片)与客户端安装侧(lib/plugin-update.js 落盘)共用。
//
// 布局前提(spike 实证,见 docs/plans/plugin-incremental-update.md):随包 tar 与
// Windows 实体化安装产物的 node_modules 是平铺真实目录,.pnpm 虚拟存储为空,
// 版本冲突以嵌套 node_modules 表达。因此闭包以 pnpm-lock.yaml 为准计算键集合
// (键 = name@version,可带 peer 后缀 "(peer@ver)"),落盘时经磁盘索引翻译成目录。
//
// 分层:闭包/集合运算是纯函数(输入 lockfile 解析结果,输出键集合);
// 文件读取与目录索引是 IO 函数;键 → 目录翻译是给定索引的纯函数。
// 不依赖 electron,纯 node 测试可直接驱动。

// ---- 纯函数:lockfile 键处理 ----

// 剥掉 peer 后缀:"0.1.3(zod@4.4.3)" -> "0.1.3"。peer 后缀内部也含 '@',
// 任何按 '@' 切分的操作都必须先剥后缀(spike 踩过的坑)。
function stripPeerSuffix(version) {
  return String(version).replace(/\(.*\)$/, '');
}

// lockfile 键 -> { name, version(已剥 peer 后缀) }。
// name 本身可带 scope 前缀 '@',version 前的 '@' 是剥后缀后的最后一个。
function splitKey(key) {
  const bare = stripPeerSuffix(key);
  const at = bare.lastIndexOf('@');
  if (at <= 0) throw new Error(`非法 lockfile 键: ${key}`);
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

// 键 -> 磁盘索引键(name@version,不含 peer 后缀;peer 变体在实体化布局里同目录)
function diskKeyOf(key) {
  const { name, version } = splitKey(key);
  return `${name}@${version}`;
}

// ---- 纯函数:闭包与集合运算 ----

// lockfileVersion 9.0:importer 的 version 形如 "0.2.2" 或 "0.1.3(zod@4.4.3)",
// 闭包键保留原始 version 串(含 peer 后缀),与 snapshots 键严格同形。
function keyOf(name, version) {
  return `${name}@${version}`;
}

// 从 importers['.'] 出发沿 snapshots 传递闭包,返回键集合(含插件自身)。
// 无 snapshot 条目的键 = 无运行时依赖(或纯 peer),不报错。
function computeClosure(lock, pkgName) {
  const entry = lock.importers?.['.']?.dependencies?.[pkgName];
  if (!entry) throw new Error(`lockfile importers 里找不到 ${pkgName}`);
  const seen = new Set();
  const queue = [keyOf(pkgName, entry.version)];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = lock.snapshots?.[key];
    if (!snap) continue;
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [depName, depVer] of Object.entries(snap[section] || {})) {
        queue.push(keyOf(depName, String(depVer)));
      }
    }
  }
  return seen;
}

// lockfile 全 profile 引用的键集合(packages + snapshots + importers)。
// 删除集必须对它求差而非仅对新闭包求差——否则误删其他插件仍在用的共享依赖。
function referencedKeys(lock) {
  const set = new Set(Object.keys(lock.packages || {}));
  for (const k of Object.keys(lock.snapshots || {})) set.add(k);
  for (const importer of Object.values(lock.importers || {})) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, entry] of Object.entries(importer[section] || {})) {
        set.add(keyOf(name, entry.version));
      }
    }
  }
  return set;
}

// 外科替换的集合运算:addKeys = 新闭包(需要拷入);
// removeKeys = 旧闭包减去新 lockfile 仍引用的全部条目(独占旧条目,需要删除)。
// 平台 optional 依赖(如 lightningcss-* 按 os/cpu 拆包)只影响磁盘翻译层,这里不管。
function planKeySets(oldLock, newLock, pkgName) {
  const addKeys = computeClosure(newLock, pkgName);
  const stillReferenced = referencedKeys(newLock);
  const removeKeys = new Set();
  for (const key of computeClosure(oldLock, pkgName)) {
    if (!stillReferenced.has(key)) removeKeys.add(key);
  }
  return { addKeys, removeKeys };
}

// ---- 纯函数:键 -> 磁盘目录翻译 ----

// 把键集合翻译成磁盘相对路径。索引里没有的键(平台 optional 依赖未发货、
// 簿记与磁盘本就漂移)不报错,收进 missing 交给调用方决策。
// 返回 { dirs: string[], missing: string[] },dirs 去重且不含嵌套包含关系。
function resolveKeysToDirs(keys, index) {
  const dirs = new Set();
  const missing = [];
  for (const key of keys) {
    const found = index.get(diskKeyOf(key));
    if (!found || found.length === 0) { missing.push(key); continue; }
    for (const rel of found) dirs.add(rel);
  }
  return { dirs: [...dirs], missing };
}

// ---- IO:lockfile 读取与磁盘索引 ----

// 解析 pnpm-lock.yaml 文本。yaml 语法错误原样上抛并附上下文,不吞。
function parseLockfile(yamlText) {
  let lock;
  try {
    lock = YAML.parse(yamlText);
  } catch (err) {
    throw new Error(`pnpm-lock.yaml 解析失败: ${err.message}`);
  }
  if (!lock || typeof lock !== 'object') throw new Error('pnpm-lock.yaml 解析结果不是对象');
  return lock;
}

// 读取并解析 profileDir/pnpm-lock.yaml;文件缺失/不可读直接抛(调用方契约错误)。
function readLockfile(profileDir) {
  return parseLockfile(fs.readFileSync(path.join(profileDir, 'pnpm-lock.yaml'), 'utf8'));
}

// 递归扫描 dir 下每层 node_modules,把含 package.json 的目录登记进索引。
// 同一 name@version 可能出现在多个嵌套位置(实体化复制会产生重复实体),
// 全部记录,删除/统计时一处不漏。坏 package.json 抛错带路径,不静默跳过。
function walkPackages(dir, rel, index) {
  if (!fs.existsSync(dir)) return; // 嵌套 node_modules 多数不存在,属正常形态
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.bin' || entry.name === '.pnpm') continue;
    if (entry.name.startsWith('@')) { walkPackages(path.join(dir, entry.name), `${rel}${entry.name}/`, index); continue; }
    const pkgRel = rel + entry.name;
    const pkgJson = path.join(dir, entry.name, 'package.json');
    if (fs.existsSync(pkgJson)) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      } catch (err) {
        throw new Error(`${pkgJson} 解析失败: ${err.message}`);
      }
      const key = `${pkg.name}@${pkg.version}`;
      const list = index.get(key);
      if (list) list.push(pkgRel); else index.set(key, [pkgRel]);
    }
    walkPackages(path.join(dir, entry.name, 'node_modules'), `${pkgRel}/node_modules/`, index);
  }
}

// 构建 profileDir 的磁盘索引:Map<'name@version', 相对路径数组>(POSIX 分隔符,
// 相对 profileDir,不带尾部斜杠)。实体化平铺布局与嵌套冲突版本都覆盖。
function indexPackages(profileDir) {
  const index = new Map();
  walkPackages(path.join(profileDir, 'node_modules'), 'node_modules/', index);
  return index;
}

// 簿记文件集合(相对 profile 根,POSIX 分隔符):外科替换时整体换新——
// spike 已实证 dsh 运行时不读 pnpm-lock 决定加载,整体替换无副作用。
// 发布侧(scripts/build-plugin-channel.js)打 bookkeeping tar 与客户端安装侧
// 应用簿记共用这一份清单,增删文件只改这里。
const BOOKKEEPING_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  'node_modules/.modules.yaml',
  'node_modules/.pnpm-workspace-state-v1.json',
  'node_modules/.pnpm/lock.yaml',
];

module.exports = {
  // 纯函数
  computeClosure,
  referencedKeys,
  planKeySets,
  resolveKeysToDirs,
  // IO
  parseLockfile,
  readLockfile,
  indexPackages,
  // 布局常量
  BOOKKEEPING_FILES,
};
