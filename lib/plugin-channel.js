const fs = require('fs');
const path = require('path');
const { parseVersion, isNewerVersion } = require('./update-check');
const { readProfileDeps } = require('./bundled-profile');

// 插件热更检测层:拉取发布侧滚动 release 的 plugin-channel.json(「现在能下到什么」
// 的唯一真源,避免 registry 有新版但发布侧还没出包的空窗),与本地 profile 的
// dependencies 比对;顺带查 npm registry 上 dsh 本体的 dist-tags(提示层,
// 本体获取仍走 electron-updater 整包)。
//
// 本模块不依赖 electron:通知动作由调用方以 notify 注入,纯逻辑与 IO 编排都能被
// 普通 node 测试直接驱动(与 lib/update-check.js 同一哲学)。
// 错误哲学一致:检测是纯增强项,一切失败折叠为具名 outcome,绝不抛进启动链。

// ---- 业务默认值单一来源 ----
const CHANNEL_URL =
  'https://github.com/HackSing/dsh-buddy/releases/download/plugin-channel/plugin-channel.json';
// 发布侧脚本(scripts/build-plugin-channel.js)把更新产物传到同一滚动 release 下,
// 客户端实际下载地址以 channel JSON 里的 tarball.url 为准,此处只是单一真源。
// v2 起每插件一个 tar + 一个簿记 tar,资产名恒定(plugin-<slug>.tar.gz),
// 全部挂在 CHANNEL_RELEASE_BASE 下;v1 整包资产(schema v1 时代)已不再产出。
const CHANNEL_RELEASE_BASE =
  'https://github.com/HackSing/dsh-buddy/releases/download/plugin-channel';
const CHANNEL_TARBALL_URL = `${CHANNEL_RELEASE_BASE}/web-profile-plugins.tar.gz`;
const DSH_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@deepseek-ai%2Fdsh/dist-tags';
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'dsh-buddy-plugin-channel'; // GitHub 强制要求 UA,缺了直接 403
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每 24 小时最多检查一次
const STATE_FILE_NAME = 'plugin-channel-check.json';
const CHANNEL_SCHEMA = 'dsh-buddy/plugin-channel/v1';
const CHANNEL_SCHEMA_V2 = 'dsh-buddy/plugin-channel/v2';
const DEFAULT_STATE = {
  lastCheckedAt: 0,
  lastNotifiedFingerprint: null, // 这个插件版本集合已提示过
  lastNotifiedDshVersion: null, // 这个 dsh 本体版本已提示过
};

// 单字段线性结果:一个值对应一件已发生的事,调用方照原样打一行日志。
const CHANNEL_OUTCOME = {
  throttled: 'throttled', // 距上次检查不足 24 小时
  unreachable: 'unreachable', // 离线、超时、限流、响应不可用
  invalidChannel: 'invalid-channel', // channel JSON schema 校验失败(发布侧发错了)
  profileUnreadable: 'profile-unreadable', // 本地 profile package.json 缺失/不可读
  upToDate: 'up-to-date', // 本地 profile 不落后于 channel
  alreadyNotified: 'already-notified', // 这个版本集合已提示过一次
  notified: 'notified', // 本次提示了用户(update.installable 区分能否直接装)
};

// ---- 纯逻辑:版本比较 ----

// update-check 的 parseVersion 丢弃预发布后缀,而 dsh 本体全是 0.1.0-rc.N 形态,
// 本体比较必须感知 rc 序号。返回 { core, pre } 或 null。
function splitPrerelease(version) {
  const m = /^v?([0-9.]+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version).trim());
  return m ? { core: m[1], pre: m[2] ?? null } : null;
}

// 预发布感知的版本比较:返回 1/0/-1,任一侧不可解析 → null。
// 核心段先按数值逐段比;核心相等时无预发布 > 有预发布(0.1.0 > 0.1.0-rc.9);
// 两侧都是 rc.N 按数值比;其余预发布形态按字符串序兜底。
function compareRelease(a, b) {
  const pa = splitPrerelease(a);
  const pb = splitPrerelease(b);
  if (!pa || !pb) return null;
  const na = parseVersion(pa.core);
  const nb = parseVersion(pb.core);
  if (!na || !nb) return null;
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i += 1) {
    const left = na[i] ?? 0;
    const right = nb[i] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ra = /^rc\.(\d+)$/.exec(pa.pre);
  const rb = /^rc\.(\d+)$/.exec(pb.pre);
  if (ra && rb) {
    return Number(ra[1]) === Number(rb[1]) ? 0 : Number(ra[1]) > Number(rb[1]) ? 1 : -1;
  }
  return pa.pre > pb.pre ? 1 : -1;
}

function isNewerRelease(remote, current) {
  return compareRelease(remote, current) === 1;
}

// ---- 纯逻辑:channel 解析与比对 ----

// channel 的版本集合指纹:作为「这个版本集合提示过」的稳定标识。
function channelFingerprint(packages) {
  return packages
    .map((p) => `${p.name}@${p.version}`)
    .sort()
    .join('\n');
}

// 边界校验:channel JSON 必须严格符合 schema,包名/版本/tarball url/sha256/minDshVersion
// 逐一验形;版本号必须可解析(发布侧写错版本在这里被拦下,不流向比对层)。
// 任何偏离 → null,调用方按 invalid-channel 处理。
function parseChannel(body) {
  if (!body || typeof body !== 'object' || body.schema_version !== CHANNEL_SCHEMA) return null;
  const { packages, tarball, minDshVersion } = body;
  if (!Array.isArray(packages) || packages.length === 0) return null;
  for (const p of packages) {
    if (!p || typeof p.name !== 'string' || typeof p.version !== 'string') return null;
    if (!parseVersion(p.version)) return null;
  }
  if (
    !tarball ||
    typeof tarball.url !== 'string' ||
    !/^https:\/\//.test(tarball.url) ||
    typeof tarball.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(tarball.sha256)
  ) {
    return null;
  }
  if (typeof minDshVersion !== 'string' || !splitPrerelease(minDshVersion)) return null;
  return { packages, tarball, minDshVersion, fingerprint: channelFingerprint(packages) };
}

// v2 的 tarball 引用验形:{url(https), sha256(64hex), size(正整数字节)},
// 每插件切片与 bookkeeping 共用同一形状。
function parseTarballRefV2(t) {
  return (
    t &&
    typeof t.url === 'string' &&
    /^https:\/\//.test(t.url) &&
    typeof t.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(t.sha256) &&
    Number.isInteger(t.size) &&
    t.size > 0
  );
}

// v2 边界校验:packages[] 每项携带独立 tarball,顶层 bookkeeping 为簿记 tar,
// minDshVersion 语义与 v1 相同。任何偏离 → null(与 v1 同一保守方向)。
// 发布侧自验与客户端(schema 分流后)共用这一个校验器,不平行再写。
function parseChannelV2(body) {
  if (!body || typeof body !== 'object' || body.schema_version !== CHANNEL_SCHEMA_V2) return null;
  const { packages, bookkeeping, minDshVersion } = body;
  if (!Array.isArray(packages) || packages.length === 0) return null;
  for (const p of packages) {
    if (!p || typeof p.name !== 'string' || typeof p.version !== 'string') return null;
    if (!parseVersion(p.version)) return null;
    if (!parseTarballRefV2(p.tarball)) return null;
  }
  if (!parseTarballRefV2(bookkeeping)) return null;
  if (typeof minDshVersion !== 'string' || !splitPrerelease(minDshVersion)) return null;
  return { packages, bookkeeping, minDshVersion, fingerprint: channelFingerprint(packages) };
}

// channel 版本集合与本地 profile deps 的差集:只列 channel 严格更新的包。
// 本地缺失或版本不可解析(如 file: spec)一律视为需要更新——无法证明足够新,
// 与 profileUpgradeDecision 的保守方向一致。
function diffChannelVersions(packages, localDeps) {
  const updates = [];
  for (const p of packages) {
    const local = localDeps[p.name];
    if (typeof local !== 'string' || !parseVersion(local)) {
      updates.push({ name: p.name, from: typeof local === 'string' ? local : null, to: p.version });
    } else if (isNewerVersion(p.version, local)) {
      updates.push({ name: p.name, from: local, to: p.version });
    }
  }
  return updates;
}

// v2 的 update 组装:updates[] 每项带各自切片 tarball,顶层带簿记 tarball;
// schema 字段是安装侧(lib/plugin-update.js)的分流依据。
function buildUpdateV2(channel, updates, currentDshVersion) {
  const byName = new Map(channel.packages.map((p) => [p.name, p]));
  return {
    schema: CHANNEL_SCHEMA_V2,
    fingerprint: channel.fingerprint,
    packages: channel.packages,
    updates: updates.map((u) => ({ ...u, tarball: byName.get(u.name).tarball })),
    bookkeeping: channel.bookkeeping,
    minDshVersion: channel.minDshVersion,
    installable: !isNewerRelease(channel.minDshVersion, currentDshVersion),
  };
}

// ---- IO:状态文件 ----

function stateFilePath(stateDir) {
  return path.join(stateDir, STATE_FILE_NAME);
}

// 反序列化即边界:缺省与类型在这里补齐,下游不再重复校验。
// 文件不存在 = 首次运行;其余读错向上抛,由 checkPluginChannel 的单一边界折叠。
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
    lastNotifiedFingerprint:
      typeof parsed.lastNotifiedFingerprint === 'string'
        ? parsed.lastNotifiedFingerprint
        : DEFAULT_STATE.lastNotifiedFingerprint,
    lastNotifiedDshVersion:
      typeof parsed.lastNotifiedDshVersion === 'string'
        ? parsed.lastNotifiedDshVersion
        : DEFAULT_STATE.lastNotifiedDshVersion,
  };
}

// 先写点号临时文件再 rename:进程中断只留临时文件,读取端永远看不到半截 JSON。
function writeState(stateDir, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const staging = path.join(stateDir, `.${STATE_FILE_NAME}.writing`);
  fs.writeFileSync(staging, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(staging, stateFilePath(stateDir));
}

// ---- IO:远端查询 ----

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// dsh 本体检测:查 registry dist-tags。纯提示层,不驱动任何安装动作。
// rc/preview 阶段上游把候选发在 next 上(rc.8 时代 latest 仍指 rc.7),
// 候选取 latest 与 next 中较新的那个;只认 latest 会永远漏报 rc 新版。
async function checkDshCore(currentDshVersion, fetchImpl) {
  try {
    const body = await fetchJson(DSH_DIST_TAGS_URL, fetchImpl);
    const tags = body && typeof body === 'object' ? Object.values(body) : [];
    const latest = tags
      .filter((v) => typeof v === 'string' && splitPrerelease(v))
      .sort((a, b) => compareRelease(a, b) ?? 0)
      .pop();
    if (!latest) {
      return { outcome: 'unreachable', detail: 'dist-tags 响应缺少可用版本' };
    }
    return isNewerRelease(latest, currentDshVersion)
      ? { outcome: 'update-available', latest }
      : { outcome: 'up-to-date', latest };
  } catch (err) {
    return { outcome: 'unreachable', detail: err.message };
  }
}

// ---- 编排 ----

// 插件 channel 检测主流程。返回 { outcome, detail?, update?, dshCore? }。
// update 存在时携带 { schema, fingerprint, packages, updates, minDshVersion, installable },
// 另按 schema 分流:v1 带顶层 tarball(整包),v2 的 updates[] 每项带各自切片
// tarball 且顶层带 bookkeeping(簿记 tar);installable=false 表示 channel 要求的
// dsh 本体比内嵌的新,只提示不安装(插件 keyed slot 等兼容门槛,
// 见 plugins/preinstall-manifest.json comment)。
// notify({ update }) 由调用方注入,只在确实要提示时被调用一次。
// force=true 用于菜单手动入口:绕过节流,记账语义不变。
async function checkPluginChannel({
  profileDir,
  stateDir,
  currentDshVersion,
  notify,
  force = false,
  now = Date.now(),
  fetchImpl = fetch,
  channelUrl = CHANNEL_URL, // 验收与测试注入本地通道;生产默认滚动 release
}) {
  let state;
  try {
    state = readState(stateDir);
  } catch (err) {
    return { outcome: CHANNEL_OUTCOME.unreachable, detail: `状态文件不可读: ${err.message}` };
  }
  if (!force && now - state.lastCheckedAt < CHECK_INTERVAL_MS) {
    return { outcome: CHANNEL_OUTCOME.throttled };
  }

  const localDeps = readProfileDeps(profileDir);
  if (!localDeps) return { outcome: CHANNEL_OUTCOME.profileUnreadable };

  // 本体检测与 channel 检测共享节流窗口,并联发出;本体失败不拖垮插件检测。
  const [channelBody, dshCore] = await Promise.all([
    fetchJson(channelUrl, fetchImpl).then(
      (body) => ({ body }),
      (err) => ({ error: err })
    ),
    checkDshCore(currentDshVersion, fetchImpl),
  ]);
  if (dshCore.outcome === 'update-available') {
    dshCore.alreadyNotified = dshCore.latest === state.lastNotifiedDshVersion;
  }

  // 记账先于提示:无论成败都刷新 lastCheckedAt(节流语义是「每 24 小时最多尝试一次」)。
  const nextState = { ...state, lastCheckedAt: now };
  if (dshCore.outcome === 'update-available' && !dshCore.alreadyNotified) {
    nextState.lastNotifiedDshVersion = dshCore.latest;
  }

  if (channelBody.error) {
    writeState(stateDir, nextState);
    return { outcome: CHANNEL_OUTCOME.unreachable, detail: channelBody.error.message, dshCore };
  }
  // schema 分流:v2(逐插件切片)优先,v1(整包)兼容通道未切换的窗口期;
  // 两者都不匹配 → invalid-channel。v1 老客户端读 v2 在其本地校验即被拒
  // (v0.2.2 实测 parseChannel(v2) === null,落 invalid-channel 一行日志,不误装不崩)。
  const v2 = parseChannelV2(channelBody.body);
  const v1 = v2 ? null : parseChannel(channelBody.body);
  if (!v2 && !v1) {
    writeState(stateDir, nextState);
    return { outcome: CHANNEL_OUTCOME.invalidChannel, dshCore };
  }
  const channel = v2 || v1;

  const updates = diffChannelVersions(channel.packages, localDeps);
  const willNotify = updates.length > 0 && channel.fingerprint !== state.lastNotifiedFingerprint;
  if (willNotify) nextState.lastNotifiedFingerprint = channel.fingerprint;
  writeState(stateDir, nextState);

  if (updates.length === 0) return { outcome: CHANNEL_OUTCOME.upToDate, dshCore };
  const update = v2
    ? buildUpdateV2(v2, updates, currentDshVersion)
    : {
        schema: CHANNEL_SCHEMA,
        fingerprint: channel.fingerprint,
        packages: channel.packages,
        updates,
        tarball: channel.tarball,
        minDshVersion: channel.minDshVersion,
        installable: !isNewerRelease(channel.minDshVersion, currentDshVersion),
      };
  if (!willNotify) {
    return { outcome: CHANNEL_OUTCOME.alreadyNotified, detail: channel.fingerprint, update, dshCore };
  }
  await notify({ update });
  return { outcome: CHANNEL_OUTCOME.notified, detail: channel.fingerprint, update, dshCore };
}

module.exports = {
  checkPluginChannel,
  CHANNEL_OUTCOME,
  CHANNEL_URL,
  CHANNEL_RELEASE_BASE,
  CHANNEL_TARBALL_URL,
  DSH_DIST_TAGS_URL,
  CHANNEL_SCHEMA,
  CHANNEL_SCHEMA_V2,
  STATE_FILE_NAME,
  CHECK_INTERVAL_MS,
  splitPrerelease,
  compareRelease,
  isNewerRelease,
  channelFingerprint,
  parseChannel,
  parseChannelV2,
  diffChannelVersions,
};
