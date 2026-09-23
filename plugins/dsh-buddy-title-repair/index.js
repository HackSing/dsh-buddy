// dsh host 插件:启动后修复投影缓存(session_projcache)里缺失标题的会话行。
//
// 背景:侧栏会话列表的冷会话标题唯一来源是 session_projcache 缓存行
// (apiproxy 的 listProjectionsFor 只读缓存,缺失即整列不给,
// 客户端回退显示 cwd 目录名)。缓存写入是节流的(200 事件/5s),强制写点
// 只有 turn/end 与 session/disposed;rc.6 之前创建的会话从未有过缓存行,
// 进程被强杀也会丢掉尾帧。两种情形都不会自愈——只有会话重新被拉起
// (session/disposed 落盘)才会补写。
//
// 本插件在 dsh 启动后遍历持久化会话,对缓存里标题缺失的冷会话调用
// sessionProjectionCache.coldSnapshot(id):从日志重折投影并立即回写缓存
// (cold-read write-back),之后的 session.list 即可在首屏就给出正确标题。
//
// 全程 fail-soft:服务缺失(上游版本不含投影缓存)或单会话读取失败只记日志,
// 绝不阻塞或拖垮 dsh 启动。

import { readColdSessionLog } from '@deepseek-ai/dsh-session-query';

export const name = 'dsh-buddy-title-repair';

// 服务轮询:dsh 启动期各插件就绪有先后,投影服务可能晚于本插件 apply。
const RETRY_INTERVAL_MS = 500;
const GIVE_UP_AFTER_MS = 30000;

// ctx.get 对未注册服务的返回/抛错行为随上游版本而定,两种都折叠成「还没就绪」。
function services(ctx) {
  try {
    const cache = ctx.get('sessionProjectionCache');
    const persistence = ctx.get('sessionPersistence');
    return cache && persistence ? { cache, persistence } : null;
  } catch {
    return null;
  }
}

// 缓存命中判定需要「会话身份」= 头部 + 继承前缀长度(identityOf),而 list() 给的
// 快照只有头部,继承长度要开句柄才知道。所以先开只读句柄做零日志读的缓存判定,
// 只有判定为缺标题时才走 readColdSessionLog 全量读——重折是稀有路径,不为它给
// 每个会话都付一次整日志读的代价。
async function cachedTitleOf(cache, persistence, id) {
  const handle = await persistence.open(id, 'read');
  try {
    return cache.cachedSnapshot(handle.header, handle.inheritedEventCount)?.values?.title;
  } finally {
    await handle.close();
  }
}

async function repairAll(ctx, isDisposed) {
  const { cache, persistence } = services(ctx);
  const listed = await persistence.list();
  let repaired = 0;
  // 跳过原因分桶:这趟扫描全程 fail-soft,不记下来就只剩一句「修了 0 个」,
  // 上游换契约时(如 0.1.5-rc.1 把 list() 的形状从裸 meta 改成 { header })
  // 会表现为静默空转而不是报错——分桶计数是唯一能从日志里看出来的地方。
  const skipped = { noCwd: 0, live: 0, titled: 0, probeFailed: 0 };
  for (const { header } of listed) {
    if (isDisposed()) return null;
    // 无 cwd 的会话本就不上 session/list 冷列表(与 apiproxy 过滤一致),跳过。
    if (header.cwd === undefined) {
      skipped.noCwd += 1;
      continue;
    }
    // 活跃会话由 live 投影服务,dispose 时强制落盘,不需要修。
    if (ctx.sessions.get(header.id) !== undefined) {
      skipped.live += 1;
      continue;
    }
    let title;
    try {
      title = await cachedTitleOf(cache, persistence, header.id);
    } catch (error) {
      // 缓存表未就绪、句柄被占等瞬时失败:本次跳过,下次启动再试。
      skipped.probeFailed += 1;
      ctx.logger.warn(`[dsh-buddy-title-repair] cache probe failed for "${header.id}": ${String(error)}`);
      continue;
    }
    // title 投影值契约:string(非空) | null;null/缺失/空串都视为待修。
    if (typeof title === 'string' && title.length > 0) {
      skipped.titled += 1;
      continue;
    }
    try {
      // dsh 0.1.5-rc.1 起 coldSnapshot 自己不读持久层,整份日志由调用方给:
      // readColdSessionLog 负责开句柄、读全量、补齐被中断 turn 的收尾事件,
      // 是上游自己冷读会话时走的同一条路。缓存有行的会话由 restore 只折增量,
      // 日志里本就没有标题事件的会话重折后仍是 null,无危害。
      const loaded = await readColdSessionLog(persistence, header.id);
      cache.coldSnapshot(loaded.header, loaded.inheritedEventCount, loaded.events);
      repaired += 1;
    } catch (error) {
      ctx.logger.warn(`[dsh-buddy-title-repair] cold read failed for "${header.id}": ${String(error)}`);
    }
  }
  return { scanned: listed.length, repaired, skipped };
}

// 过滤/修复主流程单独导出:loader 只消费 name/apply,这个导出专供单测。
export { repairAll };

export function apply(ctx) {
  let disposed = false;
  // 旧版 cordis 没有 ctx.effect:定时循环自带 30s 上限,泄漏面可控。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      disposed = true;
    }, 'dsh-buddy-title-repair');
  }
  (async () => {
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    while (!disposed && services(ctx) === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
    if (disposed) return;
    if (services(ctx) === null) {
      ctx.logger.warn('[dsh-buddy-title-repair] projection services unavailable, title repair skipped');
      return;
    }
    try {
      const summary = await repairAll(ctx, () => disposed);
      if (summary) {
        const { noCwd, live, titled, probeFailed } = summary.skipped;
        ctx.logger.info(
          `[dsh-buddy-title-repair] scanned ${summary.scanned} persisted sessions, repaired ${summary.repaired}` +
            ` (skipped: no-cwd ${noCwd}, live ${live}, already-titled ${titled}, probe-failed ${probeFailed})`
        );
      }
    } catch (error) {
      ctx.logger.warn(`[dsh-buddy-title-repair] repair pass failed: ${String(error)}`);
    }
  })();
}
