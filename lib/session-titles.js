const http = require('http');
const crypto = require('crypto');

// 首屏标题就绪门:等标题修复插件(plugins/dsh-buddy-title-repair)把缺失的
// 会话标题回写进投影缓存之后,再放 web UI 加载——否则客户端首帧 session.list
// 拿到的是无标题行(客户端回退显示 cwd 目录名),且列表不会自动重取。
//
// 全程 fail-soft:轮询超时就放行启动,标题退化为旧行为(点击会话后刷新),
// 绝不因修复链路故障挡住用户进界面。

// 上限的取舍:修复是按会话顺序的本地小读(有缓存行只读日志尾部),几十个会话
// 也是亚秒级;10s 只兜「会话特别多/磁盘特别慢」的尾,代价是一次性启动延迟。
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERVAL_MS = 500;
// 单次请求超时:目标是本机回环,2s 已极宽松。
const REQUEST_TIMEOUT_MS = 2000;

// POST 一次 session.list(dsh host API 的 unary 调用:路径即方法,
// 信封 client-request,业务错误走 200 + result.ok=false)。
function postSessionList(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'session.list',
      payload: {},
    });
    const req = http.request(
      `${url}/api/session.list`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`session.list HTTP ${res.statusCode}`));
            return;
          }
          try {
            const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (message?.result?.ok !== true) {
              reject(new Error(`session.list rejected: ${JSON.stringify(message?.result?.error ?? message)}`));
              return;
            }
            resolve(Array.isArray(message.result.value?.items) ? message.result.value.items : []);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('session.list request timed out')));
    req.end(body);
  });
}

// 标题是否可用:与客户端 displayTitleOf 的标题来源一致
// (title 投影值契约是非空 string 或 null)。
function titleOf(item) {
  const title = item?.projections?.values?.title;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

// 还缺标题的会话行。两类不参与判定:
// - blank:从未开 turn 的空会话本就没有标题,客户端显示「新会话」,不是缺陷;
// - running:活跃会话走 live 投影,标题可能正在生成,由实时事件推到客户端。
function untitledSessions(items) {
  return items.filter((item) => !item.blank && !item.running && titleOf(item) === null);
}

// 轮询直到列表里没有缺标题的会话,或超时。listFn 可注入(测试用),
// 缺省走真实 HTTP。返回 { settled, pending, error? };error 是最后一次请求失败,
// 仅作诊断,不向上抛。
async function waitForTitlesSettled(url, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS, listFn } = {}) {
  const list = listFn ?? (() => postSessionList(url));
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastPending = null; // 最近一次成功取数时的缺标题计数;请求全败则保持 null
  for (;;) {
    try {
      const pending = untitledSessions(await list());
      if (pending.length === 0) return { settled: true, pending: 0 };
      lastPending = pending.length;
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      return {
        settled: false,
        pending: lastPending,
        ...(lastError ? { error: lastError.message } : {}),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = { waitForTitlesSettled, untitledSessions, titleOf, postSessionList };
