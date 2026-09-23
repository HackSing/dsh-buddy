const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const tar = require('tar');
const {
  installBundledProfile,
  profileUpgradeDecision,
  readProfileDeps,
  backupDirName,
} = require('./bundled-profile');
const { CHANNEL_SCHEMA_V2 } = require('./plugin-channel');
const {
  planKeySets,
  readLockfile,
  indexPackages,
  resolveKeysToDirs,
  BOOKKEEPING_FILES,
} = require('./profile-closure');

// 插件热更的安装编排:按 plugin-channel 检测层给出的 update 描述,schema 分流——
// - v1(整包):下载整 profile 更新 tar → sha256 校验 → installBundledProfile 落进
//   DSH_HOME(兼容通道未切 v2 的窗口期);
// - v2(逐插件):逐个下载变化插件的闭包切片 + 簿记 tar,全部校验通过后在
//   profile 副本上外科替换(切片覆盖 → planKeySets 删除集 GC → 最后落簿记),
//   再以 installBundledProfile 同语义的备份/rename 换入。
//
// 为什么不在用户机上跑 dsh plugin add:内嵌 dsh 不带 pnpm,且随包 tar 解出的
// profile 其 pnpm 维护通道已坏(virtualStoreDir 漂移,见 docs/knowledge),所以
// 更新物以成品 tar 分发,安装链路全部复用随包 profile 的已实证路径。
//
// 不依赖 electron,fetch 可注入,纯 node 测试可直接驱动。
// 错误哲学:任何失败折叠为 { outcome: 'failed', detail },不抛给调用方;
// 只有全部校验通过的产物才会触碰现有 profile,失败现场不留半成品。

// ---- 业务默认值单一来源 ----
const DOWNLOAD_NAME = 'plugin-update.tar.gz';
// 超时只分段不设总时长上限:AbortSignal.timeout 挂在 fetch 上连 body 下载一起计时,
// 数十 MB 的 tar 在慢网络下必然被任何固定总预算掐断(线上表现为 aborted due to timeout)。
const HEADER_TIMEOUT_MS = 15000; // 建连+响应头预算,略宽于检测层整请求的 10s
const BODY_IDLE_TIMEOUT_MS = 30000; // body 连续无进展判定线,每收到一块数据即重置

const PLUGIN_UPDATE_OUTCOME = {
  installed: 'installed', // profile 此前不存在,首次安装
  upgraded: 'upgraded', // 旧目录备份后整体替换
  preserved: 'preserved', // 真实更新被清单外插件挡住,未覆盖(detail 给包名)
  failed: 'failed', // 下载/校验/安装失败,现有 profile 未受影响
};

// 下载 url 到 downloadDir,写盘与哈希走流式两遍;sha256 不符即删除临时文件并抛错。
// 先落点号 staging 文件再 rename,进程中断不会留下"看起来完整"的坏包。
// onProgress({ transferred, total }) 逐块上报,total 取 Content-Length(可能缺省为 null)。
// fileName 供 v2 逐插件下载区分多个产物;v1 整包用默认名,行为不变。
// 超时两段式(预算可注入,默认取上方单一来源):响应头段到点未收头判连接失败;
// body 段只看连续无进展时长,慢而流动的下载不受总时长惩罚。
async function downloadTarball({
  url,
  sha256,
  downloadDir,
  fetchImpl = fetch,
  onProgress,
  fileName = DOWNLOAD_NAME,
  headerTimeoutMs = HEADER_TIMEOUT_MS,
  bodyIdleTimeoutMs = BODY_IDLE_TIMEOUT_MS,
}) {
  const controller = new AbortController();
  let timer = null;
  const armTimeout = (ms, message) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(message)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  };
  const armIdle = () =>
    armTimeout(bodyIdleTimeoutMs, `下载停滞: 连续 ${Math.round(bodyIdleTimeoutMs / 1000)}s 未收到数据`);
  armTimeout(headerTimeoutMs, `连接超时: ${headerTimeoutMs}ms 内未收到响应头`);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('响应无内容');
    armIdle(); // 响应头已到,计时语义从"建连预算"切换为"body 空闲判定"
    const contentLength = Number(res.headers && res.headers.get('content-length'));
    const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

    fs.mkdirSync(downloadDir, { recursive: true });
    const dest = path.join(downloadDir, fileName);
    const staging = path.join(downloadDir, `.${fileName}.downloading`);
    fs.rmSync(staging, { force: true });
    try {
      let transferred = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          armIdle(); // 有数据就续命
          transferred += chunk.length;
          if (onProgress) onProgress({ transferred, total });
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(staging));

      const hash = crypto.createHash('sha256');
      await pipeline(fs.createReadStream(staging), async (stream) => {
        for await (const chunk of stream) hash.update(chunk);
      });
      const actual = hash.digest('hex');
      if (actual !== sha256) {
        throw new Error(`sha256 不符(期望 ${sha256.slice(0, 12)}…,实得 ${actual.slice(0, 12)}…)`);
      }
      fs.rmSync(dest, { force: true });
      fs.renameSync(staging, dest);
      return dest;
    } catch (err) {
      fs.rmSync(staging, { force: true });
      throw err;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- v2:逐插件外科替换 ----

// tar 条目归属的最深包目录:node_modules/<name> 或嵌套 .../node_modules/<name>
// (含 @scope 两段)。非包内条目(不会出现于切片)返回 null。
function owningPackageDir(entryPath) {
  const segs = entryPath.split('/');
  let owner = null;
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segs[i] !== 'node_modules') continue;
    if (segs[i + 1].startsWith('@')) {
      if (i + 2 < segs.length) owner = segs.slice(0, i + 3).join('/');
    } else {
      owner = segs.slice(0, i + 2).join('/');
    }
  }
  return owner;
}

// 切片 tar 的最小替换根集合:条目归属包目录剔除被其他包目录包含的
// (嵌套闭包条目随顶层包目录一起删换,不单独处理)。
function sliceRoots(tarballPath) {
  const owners = new Set();
  tar.t({
    file: tarballPath,
    sync: true,
    onentry: (entry) => {
      const owner = owningPackageDir(entry.path);
      if (owner) owners.add(owner);
    },
  });
  const list = [...owners];
  return list.filter((dir) => !list.some((other) => other !== dir && dir.startsWith(`${other}/`)));
}

// 解包切片/簿记 tar 到目标目录。发布侧从实体化布局打包,只含实体文件/目录;
// 链接条目与越界路径直接抛错(sha256 已校验,这里守的是内容形状边界)。
function untarVerified(tarballPath, destDir) {
  tar.x({
    file: tarballPath,
    cwd: destDir,
    sync: true,
    filter: (entryPath, entry) => {
      if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'Directory') {
        throw new Error(`tar 含不支持条目: ${entry.type} ${entryPath}`);
      }
      const norm = path.normalize(entryPath);
      if (path.isAbsolute(norm) || norm.startsWith('..')) {
        throw new Error(`tar 条目越界: ${entryPath}`);
      }
      return true;
    },
  });
}

// 逐插件下载切片 + 簿记,全部 sha256 校验通过才返回。聚合进度:
// total = 各 ref.size 之和,transferred = 已完成 size 累计 + 当前插件 transferred,
// 载荷形状仍是 { transferred, total },调用方(浮层)无感。任一失败抛错,
// 各文件自己的 staging 由 downloadTarball 内部清理。
async function downloadSlices({ update, downloadDir, fetchImpl, onProgress }) {
  const items = [
    ...update.updates.map((u) => ({ key: u.name, ref: u.tarball })),
    { key: '.bookkeeping', ref: update.bookkeeping },
  ];
  const total = items.reduce((sum, i) => sum + i.ref.size, 0);
  const files = new Map();
  let base = 0;
  try {
    for (const item of items) {
      const progress =
        onProgress &&
        (({ transferred }) => onProgress({ transferred: Math.min(base + transferred, total), total }));
      const file = await downloadTarball({
        ...item.ref,
        fileName: `plugin-slice-${files.size}.tar.gz`,
        downloadDir,
        fetchImpl,
        onProgress: progress,
      });
      files.set(item.key, file);
      base += item.ref.size;
    }
  } catch (err) {
    // 已下载部分不留半成品:失败的下载自己清了 staging,这里清已完成的切片
    for (const f of files.values()) fs.rmSync(f, { force: true });
    throw err;
  }
  return files; // key: 插件名 或 '.bookkeeping'
}

// 在 profile 副本(stagingDir)上应用全部切片:逐切片先删替换根再解包 →
// 按 planKeySets(本地旧 lockfile, 通道新 lockfile) 删独占旧目录 → 最后落簿记。
// 删除集跳过切片替换根覆盖的路径——那里的旧内容已被替换根删除,再删会误伤新文件
// (同名包的新旧版本在同一顶层路径)。抛错由调用方折叠,副本丢弃。
function applySlicesToStaging({ stagingDir, sliceFiles, updates, bookkeepingDir }) {
  const oldLock = readLockfile(stagingDir);
  const newLock = readLockfile(bookkeepingDir);
  const index = indexPackages(stagingDir); // 旧布局目录位置,删除集翻译以它为准

  const replacedRoots = new Set();
  for (const u of updates) {
    const tarPath = sliceFiles.get(u.name);
    for (const root of sliceRoots(tarPath)) {
      replacedRoots.add(root);
      fs.rmSync(path.join(stagingDir, ...root.split('/')), { recursive: true, force: true });
    }
    untarVerified(tarPath, stagingDir);
  }

  const removeKeys = new Set();
  for (const u of updates) {
    for (const key of planKeySets(oldLock, newLock, u.name).removeKeys) removeKeys.add(key);
  }
  const { dirs, missing } = resolveKeysToDirs(removeKeys, index);
  for (const key of missing) console.warn(`[plugin-update] 删除集键无磁盘映射,跳过: ${key}`);
  for (const rel of dirs) {
    if (replacedRoots.has(rel)) continue;
    fs.rmSync(path.join(stagingDir, ...rel.split('/')), { recursive: true, force: true });
  }

  // 簿记最后落:package.json/pnpm-lock.yaml 等 7 件整体换新(spike 已实证无副作用)
  for (const f of BOOKKEEPING_FILES) {
    fs.copyFileSync(
      path.join(bookkeepingDir, ...f.split('/')),
      path.join(stagingDir, ...f.split('/'))
    );
  }
}

// v2 安装主流程。update 为检测层 parseChannelV2 路径给出的 update 对象。
// 与 v1 同一错误哲学:失败折叠 { outcome: 'failed', detail },原 profile 分毫不动;
// 清单外插件判定(profileUpgradeDecision)提到下载前——不为注定 preserved 的单
// 白下几十 MB。retired 为退休包名数组,透传给判定层(不计 extras、出现即强制升级)。
async function applyPluginUpdateV2({ update, dshHome, profileName, downloadDir, fetchImpl = fetch, onProgress, prepareInstall, retired = [] }) {
  const profilesRoot = path.join(dshHome, 'profiles');
  const profileDir = path.join(profilesRoot, profileName);
  const staging = path.join(profilesRoot, `.${profileName}.installing`);
  const bookkeepingDir = path.join(downloadDir, '.plugin-bookkeeping');

  const deps = readProfileDeps(profileDir);
  if (!deps) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: '本地 profile 缺失或不可读,无法外科更新' };
  }
  const decision = profileUpgradeDecision(deps, update.packages, retired);
  if (decision.status === 'preserved') {
    return { outcome: PLUGIN_UPDATE_OUTCOME.preserved, extras: decision.extras };
  }
  // preserved-current:有清单外插件但无真实更新,静默折叠为 up-to-date;
  // up-to-date:下载期间本地已不落后
  if (decision.status === 'preserved-current' || decision.status === 'up-to-date') {
    return { outcome: 'up-to-date' };
  }

  let sliceFiles;
  try {
    sliceFiles = await downloadSlices({ update, downloadDir, fetchImpl, onProgress });
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `下载失败: ${err.message}` };
  }
  try {
    if (prepareInstall) await prepareInstall(); // 停 dsh 压到安装前一刻(Windows 文件锁)

    fs.rmSync(bookkeepingDir, { recursive: true, force: true });
    fs.mkdirSync(bookkeepingDir, { recursive: true });
    untarVerified(sliceFiles.get('.bookkeeping'), bookkeepingDir);

    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(profileDir, staging, { recursive: true });
    applySlicesToStaging({ stagingDir: staging, sliceFiles, updates: update.updates, bookkeepingDir });

    // 与 installBundledProfile 同语义:整目录备份旧 profile → rename 换入,失败回滚
    const backup = path.join(profilesRoot, backupDirName(profileName, deps, update.packages));
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(profileDir, backup);
    try {
      fs.renameSync(staging, profileDir);
    } catch (err) {
      fs.renameSync(backup, profileDir);
      throw err;
    }
    return { outcome: PLUGIN_UPDATE_OUTCOME.upgraded, backup: path.basename(backup) };
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `安装失败: ${err.message}` };
  } finally {
    for (const f of new Set(sliceFiles.values())) fs.rmSync(f, { force: true }); // 下载产物即弃
    fs.rmSync(bookkeepingDir, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// v1 整包热更主流程(通道未切 v2 的窗口期兼容路径)。update 为 plugin-channel
// 检测层返回的 v1 update 对象。onProgress 透传下载进度;prepareInstall(可选)
// 在下载+校验通过、安装开始前调用——壳用它把「停 dsh」压到安装前一刻,
// 下载期间 dsh 照常服务。返回 { outcome, detail?, extras?, backup? }。
async function applyPluginUpdateV1({ update, dshHome, profileName, downloadDir, fetchImpl = fetch, onProgress, prepareInstall, retired = [] }) {
  let tarballPath;
  try {
    tarballPath = await downloadTarball({ ...update.tarball, downloadDir, fetchImpl, onProgress });
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `下载失败: ${err.message}` };
  }
  try {
    if (prepareInstall) await prepareInstall();
    const result = await installBundledProfile({
      tarballPath,
      dshHome,
      profileName,
      manifestPackages: update.packages,
      retiredPackages: retired,
    });
    if (result.status === 'preserved') {
      return { outcome: PLUGIN_UPDATE_OUTCOME.preserved, extras: result.extras };
    }
    // preserved-current:有清单外插件但无真实更新,静默折叠为 up-to-date
    if (result.status === 'preserved-current') {
      return { outcome: 'up-to-date' };
    }
    // installed / upgraded / up-to-date(下载后本地已不落后,正常幂等结果)
    return { outcome: result.status, backup: result.backup };
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `安装失败: ${err.message}` };
  } finally {
    fs.rmSync(tarballPath, { force: true }); // 安装完成后更新包即弃,不堆积
  }
}

// 安装入口:按检测层 update.schema 分流;无 schema 字段的旧构造视为 v1。
function applyPluginUpdate(args) {
  return args.update && args.update.schema === CHANNEL_SCHEMA_V2
    ? applyPluginUpdateV2(args)
    : applyPluginUpdateV1(args);
}

module.exports = { applyPluginUpdate, downloadTarball, PLUGIN_UPDATE_OUTCOME, DOWNLOAD_NAME };
