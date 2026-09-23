const http = require('http');

// dsh 0.1.5-rc.1 起 web 带浏览器授权门,本模块是壳与门禁消费这道门的单一来源。
//
// 授权流(上游 @deepseek-ai/dsh-client-connection 的 BrowserAuth):
//   1. `dsh web` 启动结算后往 stdout 打印一行 `dsh web: <url>?token=<launch token>`;
//   2. GET /?token=<token> 回 303 + `dsh-auth-<authority>=<签名值>` cookie,并跳到干净的 /;
//   3. 之后 GET / 与 POST /api/* 一律只认这个 cookie,没有就是 401。
// 因此:窗口加载要用带 token 的 URL(浏览器自己走完 2、3),而主进程侧的 HTTP 调用
// (首屏标题门、门禁探测)要先换出 cookie 再带着走。

// 单次 HTTP 往返超时:目标都在本地回环,1 秒足够(与 lib/http-probe 的取值同量级)。
const DEFAULT_TIMEOUT_MS = 1000;
// 启动行形状:`dsh web: <url>`,后面可能跟 ` (LAN: <url>)`。同前缀的还有
// `dsh web: opening the default browser...` 这类非 URL 行,逐个匹配后按能否解析出
// token 决定取舍,不靠行序假设。
const LAUNCH_LINE_PATTERN = /^dsh web: (\S+)/gm;
const TOKEN_QUERY = 'token';
// 授权 cookie 的名字前缀(上游按 authority 生成完整名字:`dsh-auth-<签名的 authority>`)。
// 壳用它判断 Electron 会话里是否还留着上次的授权,不自行解析后半段。
const AUTH_COOKIE_PREFIX = 'dsh-auth-';

// 从 dsh web 的输出文本里解析 launch token;没有则 null。
// 纯函数:调用方给多少文本就在多少文本里找,不做 IO、不缓存。
function launchTokenFrom(text) {
  for (const match of String(text).matchAll(LAUNCH_LINE_PATTERN)) {
    let url;
    try {
      url = new URL(match[1]);
    } catch (_) {
      continue; // 不是 URL 的同前缀行(如 opening the default browser)
    }
    const token = url.searchParams.get(TOKEN_QUERY);
    if (token) return token;
  }
  return null;
}

// 给根 URL 附上 launch token。token 为空时原样返回:调用方无需自己分支,
// 「没有 token」由这里统一退化成「裸 URL」(此时能不能进 UI 取决于浏览器侧已有 cookie)。
function authenticatedUrl(baseUrl, token) {
  if (!token) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set(TOKEN_QUERY, token);
  return url.toString();
}

// 盯住 dsh 子进程输出直到解析出 launch token。
// 拿到返回 token;进程先退出、或超时未打印都返回 null——「没打印 token」是调用方要
// 据以决策的正常观测结果,不是异常。只旁听不消费(不改变原有 data 监听者的行为)。
function waitForLaunchToken(child, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = (token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      resolve(token);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      const token = launchTokenFrom(buffer);
      if (token) finish(token);
    };
    const onExit = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.(); // 定时器不该把壳的事件循环钉住
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
  });
}

// 用 launch token 换出授权 cookie,返回可直接作为 Cookie 请求头的 `name=value`。
// 失败一律抛错(连接失败、超时、状态码不是 303、响应没带 cookie):调用方各有各的
// 降级方式(门禁记failure、壳跳过标题门),由它们显式处理,这里不替它们决定。
function exchangeAuthCookie(baseUrl, token, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(authenticatedUrl(baseUrl, token), (res) => {
      res.resume(); // 303 的响应体没有用处,丢弃以释放连接
      const cookie = res.headers['set-cookie']?.[0];
      if (res.statusCode !== 303 || !cookie) {
        reject(new Error(`token 换 cookie 失败:HTTP ${res.statusCode}${cookie ? '' : ',响应未带 set-cookie'}`));
        return;
      }
      resolve(cookie.split(';')[0]); // 属性段(Max-Age/Path/HttpOnly...)不进请求头
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('token 换 cookie 超时')));
  });
}

module.exports = { AUTH_COOKIE_PREFIX, launchTokenFrom, authenticatedUrl, waitForLaunchToken, exchangeAuthCookie };
