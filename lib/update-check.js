const fs = require('fs');
const path = require('path');

// 启动更新检查:只查、只提示,不下载不安装。
// 本模块刻意不依赖 electron —— 提示动作由调用方以 notify 注入,
// 于是纯逻辑与 IO 编排都能被普通 node 冒烟脚本直接驱动。

// ---- 业务默认值单一来源 ----
const RELEASE_API_URL = 'https://api.github.com/repos/HackSing/dsh-buddy/releases/latest';
const REQUEST_TIMEOUT_MS = 10000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每 24 小时最多检查一次
const USER_AGENT = 'dsh-buddy-update-check'; // GitHub API 强制要求 UA,缺了直接 403
const STATE_FILE_NAME = 'update-check.json';
const DEFAULT_STATE = { lastCheckedAt: 0, lastNotifiedVersion: null };

// 单字段线性结果:一个值对应一件已发生的事,调用方只需照原样打一行日志。
const UPDATE_OUTCOME = {
  throttled: 'throttled', // 距上次检查不足 24 小时
  unreachable: 'unreachable', // 离线、超时、限流、响应不可用
  noRelease: 'no-release', // 仓库还没发过 release(404)
  upToDate: 'up-to-date', // 远端不比当前新
  alreadyNotified: 'already-notified', // 这个版本已经提示过一次
  notified: 'notified', // 本次提示了用户
};

// ---- 纯逻辑:无 IO,可直接断言 ----

// 解析版本号为数值段数组:容忍前导 v 与首尾空白,丢弃 - 之后的预发布后缀。
// 任何一段不是纯数字 → null,表示「无法比较」。
function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const core = text.trim().replace(/^v/i, '').split('-')[0];
  const parts = core.split('.');
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.map(Number);
}

// 归一化 release tag 为版本字符串(去空白与前导 v,保留预发布后缀),
// 作为「这个版本提示过」的稳定标识:v0.2.0 与 0.2.0 视为同一版本。
function normalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  const normalized = tag.trim().replace(/^v/i, '');
  return normalized === '' ? null : normalized;
}

// 远端是否比本地新:逐段数值比较,段数不等时短的一侧按 0 补齐(0.2 === 0.2.0)。
// 预发布后缀不参与比较,故 0.2.0-rc.1 不会被当成比 0.2.0 更新的版本推给用户。
// 任一侧无法解析 → false:宁可不提示,也不基于猜测打扰用户。
function isNewerVersion(remote, current) {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

// 节流判定:距上次检查满 24 小时才允许再查。
function isCheckDue(state, now) {
  return now - state.lastCheckedAt >= CHECK_INTERVAL_MS;
}

// 提示判定:远端更新,且这个版本还没提示过。
function shouldNotify(state, remoteVersion, currentVersion) {
  return (
    isNewerVersion(remoteVersion, currentVersion) && remoteVersion !== state.lastNotifiedVersion
  );
}

// ---- IO:状态文件 ----

function stateFilePath(stateDir) {
  return path.join(stateDir, STATE_FILE_NAME);
}

// 读状态。文件不存在 = 首次运行,返回默认值;其余读写错误向上抛,
// 由 checkForUpdate 调用方的单一边界记录(见 main.js 的接线注释)。
// 反序列化即边界:在这里补齐缺省与类型,下游不再重复校验。
function readState(stateDir) {
  let raw;
  try {
    raw = fs.readFileSync(stateFilePath(stateDir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    throw err;
  }
  const parsed = JSON.parse(raw);
  return {
    lastCheckedAt: Number.isFinite(parsed.lastCheckedAt)
      ? parsed.lastCheckedAt
      : DEFAULT_STATE.lastCheckedAt,
    lastNotifiedVersion:
      typeof parsed.lastNotifiedVersion === 'string'
        ? parsed.lastNotifiedVersion
        : DEFAULT_STATE.lastNotifiedVersion,
  };
}

// 写状态:先写点号开头的临时文件再 rename(与 bundled-presets 的安装同一手法)。
// 进程中断只会留下临时文件,读取端永远看不到半截 JSON,
// 因此 readState 不需要为「损坏的状态文件」准备兜底分支。
function writeState(stateDir, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const staging = path.join(stateDir, `.${STATE_FILE_NAME}.writing`);
  fs.writeFileSync(staging, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(staging, stateFilePath(stateDir));
}

// ---- IO:GitHub Release 查询 ----

// 拉取最新 release,成功返回 { release: { tag, url } },否则返回具名的跳过原因。
// 断网、DNS 失败、10s 超时、限流(403)、响应体不可解析、仓库还没发过 release(404)
// 全是「这次拿不到」这一可预期状态,不是异常:更新检查是纯增强项,
// 这些情况下正确的处置就是静默跳过,而不是向启动链抛错。detail 保留原因不丢信息。
async function fetchLatestRelease() {
  try {
    const res = await fetch(RELEASE_API_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 404) return { outcome: UPDATE_OUTCOME.noRelease };
    if (!res.ok) return { outcome: UPDATE_OUTCOME.unreachable, detail: `HTTP ${res.status}` };

    const body = await res.json();
    const tag = normalizeTag(body.tag_name);
    if (!tag || typeof body.html_url !== 'string') {
      return { outcome: UPDATE_OUTCOME.unreachable, detail: 'release 响应缺少 tag_name/html_url' };
    }
    return { release: { tag, url: body.html_url } };
  } catch (err) {
    return { outcome: UPDATE_OUTCOME.unreachable, detail: err.message };
  }
}

// ---- 编排 ----

// 更新检查主流程。返回 { outcome, detail },outcome 取 UPDATE_OUTCOME 之一。
// notify({ version, url }) 由调用方注入,只在确实要提示时被调用一次。
async function checkForUpdate({ currentVersion, stateDir, notify, now = Date.now() }) {
  const state = readState(stateDir);
  if (!isCheckDue(state, now)) return { outcome: UPDATE_OUTCOME.throttled };

  const fetched = await fetchLatestRelease();
  const tag = fetched.release ? fetched.release.tag : null;
  const willNotify = tag !== null && shouldNotify(state, tag, currentVersion);

  // 记账先于提示:无论网络成败都刷新 lastCheckedAt(节流语义是「每 24 小时最多尝试
  // 一次」,否则离线时每次启动都会重试);决定要提示时同步写下 lastNotifiedVersion,
  // 用户不点按钮也不会在下次启动被同一版本重复打扰。
  writeState(stateDir, {
    lastCheckedAt: now,
    lastNotifiedVersion: willNotify ? tag : state.lastNotifiedVersion,
  });

  if (tag === null) return { outcome: fetched.outcome, detail: fetched.detail };
  if (!willNotify) {
    const outcome = isNewerVersion(tag, currentVersion)
      ? UPDATE_OUTCOME.alreadyNotified
      : UPDATE_OUTCOME.upToDate;
    return { outcome, detail: tag };
  }

  await notify({ version: tag, url: fetched.release.url });
  return { outcome: UPDATE_OUTCOME.notified, detail: tag };
}

module.exports = {
  checkForUpdate,
  UPDATE_OUTCOME,
  parseVersion,
  normalizeTag,
  isNewerVersion,
  isCheckDue,
  shouldNotify,
  CHECK_INTERVAL_MS,
  STATE_FILE_NAME,
  RELEASE_API_URL,
};
