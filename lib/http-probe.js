const http = require('http');

// 单次探测超时:目标都在本地回环上,要么已在监听,要么根本没起,1 秒足够。
const DEFAULT_PROBE_TIMEOUT_MS = 1000;
// 轮询间隔:启动等待场景下 300ms 既不空转也不显著拖慢就绪判定。
const DEFAULT_INTERVAL_MS = 300;

// GET 探测一次,返回 HTTP 状态码;连接失败或超时返回 null。
// 「不可达」是探测的正常结果而不是异常——调用方要的就是「此刻通不通」这个事实,
// 因此这里把 error/timeout 折叠成 null,不向上抛。
// headers 供带授权 cookie 的探测使用(dsh 0.1.5-rc.1 起裸 GET / 一律 401,
// 「真的能出页面」必须带 cookie 才问得出来,见 lib/dsh-browser-auth.js)。
function probeHttp(url, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, headers } = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, headers ? { headers } : {}, (res) => {
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

// GET 一次并取回响应体:页面守护的代际探测要读首页里的 __DSH_BOOT__ rev,
// 只有状态码不够用。错误哲学与 probeHttp 一致:不可达/超时折叠为 null。
// headers 同 probeHttp:授权门之后首页必须带 cookie 才拿得到真实 HTML。
function probeBody(url, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, headers } = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, headers ? { headers } : {}, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', () => resolve(null));
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
async function waitForHttp(url, { timeoutMs, accept, headers, probeTimeoutMs, intervalMs } = {}) {
  const probeMs = probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const waitMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await probeHttp(url, { timeoutMs: probeMs, headers });
    if (status !== null && accept(status)) return status;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return null;
}

module.exports = { probeHttp, probeBody, waitForHttp };
