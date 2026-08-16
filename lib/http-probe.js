const http = require('http');

// 单次探测超时:目标都在本地回环上,要么已在监听,要么根本没起,1 秒足够。
const DEFAULT_PROBE_TIMEOUT_MS = 1000;
// 轮询间隔:启动等待场景下 300ms 既不空转也不显著拖慢就绪判定。
const DEFAULT_INTERVAL_MS = 300;

// GET 探测一次,返回 HTTP 状态码;连接失败或超时返回 null。
// 「不可达」是探测的正常结果而不是异常——调用方要的就是「此刻通不通」这个事实,
// 因此这里把 error/timeout 折叠成 null,不向上抛。
function probeHttp(url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume(); // 丢弃响应体,只取状态码
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// 轮询直到 accept(status) 成立或超过 timeoutMs。
// 成立时返回该状态码,超时返回 null。accept 由调用方给:
// 壳只要「进程在监听」(5xx 也算),兼容验证要「真的能出页面」(严格 200)。
async function waitForHttp(url, { timeoutMs, accept, probeTimeoutMs, intervalMs } = {}) {
  const probeMs = probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const waitMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await probeHttp(url, probeMs);
    if (status !== null && accept(status)) return status;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return null;
}

module.exports = { probeHttp, waitForHttp };
