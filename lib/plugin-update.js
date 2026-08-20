const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const { installBundledProfile } = require('./bundled-profile');

// 插件热更的安装编排:按 plugin-channel 检测层给出的 update 描述,
// 下载整 profile 更新 tar → sha256 校验 → 复用 installBundledProfile 的
// staging/解包/备份/rename 链路落进 DSH_HOME。
//
// 为什么不在用户机上跑 dsh plugin add:内嵌 dsh 不带 pnpm,且随包 tar 解出的
// profile 其 pnpm 维护通道已坏(virtualStoreDir 漂移,见 docs/knowledge),所以
// 更新物以成品 tar 分发,安装链路全部复用随包 profile 的已实证路径。
//
// 不依赖 electron,fetch 可注入,纯 node 测试可直接驱动。
// 错误哲学:任何失败折叠为 { outcome: 'failed', detail },不抛给调用方;
// 只有校验通过的 tar 才会触碰现有 profile,失败现场不留半成品。

// ---- 业务默认值单一来源 ----
const DOWNLOAD_NAME = 'plugin-update.tar.gz';
const REQUEST_TIMEOUT_MS = 30000; // tar 数十 MB,比检测层的 10s 宽容

const PLUGIN_UPDATE_OUTCOME = {
  installed: 'installed', // profile 此前不存在,首次安装
  upgraded: 'upgraded', // 旧目录备份后整体替换
  preserved: 'preserved', // 含清单外插件,未覆盖(detail 给包名)
  failed: 'failed', // 下载/校验/安装失败,现有 profile 未受影响
};

// 下载 url 到 downloadDir,写盘与哈希走流式两遍;sha256 不符即删除临时文件并抛错。
// 先落点号 staging 文件再 rename,进程中断不会留下"看起来完整"的坏包。
// onProgress({ transferred, total }) 逐块上报,total 取 Content-Length(可能缺省为 null)。
async function downloadTarball({ url, sha256, downloadDir, fetchImpl, onProgress }) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('响应无内容');
  const contentLength = Number(res.headers && res.headers.get('content-length'));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

  fs.mkdirSync(downloadDir, { recursive: true });
  const dest = path.join(downloadDir, DOWNLOAD_NAME);
  const staging = path.join(downloadDir, `.${DOWNLOAD_NAME}.downloading`);
  fs.rmSync(staging, { force: true });
  try {
    let transferred = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
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
}

// 热更主流程。update 为 plugin-channel 检测层返回的 update 对象。
// onProgress 透传下载进度;prepareInstall(可选)在下载+校验通过、安装开始前
// 调用——壳用它把「停 dsh」压到安装前一刻,下载期间 dsh 照常服务。
// 返回 { outcome, detail?, extras?, backup? },outcome 取 PLUGIN_UPDATE_OUTCOME 之一。
async function applyPluginUpdate({ update, dshHome, profileName, downloadDir, fetchImpl = fetch, onProgress, prepareInstall }) {
  let tarballPath;
  try {
    tarballPath = await downloadTarball({ ...update.tarball, downloadDir, fetchImpl, onProgress });
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `下载失败: ${err.message}` };
  }
  try {
    if (prepareInstall) await prepareInstall();
    const result = installBundledProfile({
      tarballPath,
      dshHome,
      profileName,
      manifestPackages: update.packages,
    });
    if (result.status === 'preserved') {
      return { outcome: PLUGIN_UPDATE_OUTCOME.preserved, extras: result.extras };
    }
    // installed / upgraded / up-to-date(下载后本地已不落后,正常幂等结果)
    return { outcome: result.status, backup: result.backup };
  } catch (err) {
    return { outcome: PLUGIN_UPDATE_OUTCOME.failed, detail: `安装失败: ${err.message}` };
  } finally {
    fs.rmSync(tarballPath, { force: true }); // 安装完成后更新包即弃,不堆积
  }
}

module.exports = { applyPluginUpdate, downloadTarball, PLUGIN_UPDATE_OUTCOME, DOWNLOAD_NAME };
