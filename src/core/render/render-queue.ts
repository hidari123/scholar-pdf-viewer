/**
 * **渲染队列**（把多个页面的 canvas 渲染**串行化**）。
 *
 * ## 为什么需要（实测）
 *
 * 缩放时 4 个可见页的 canvas **在同一帧**里全部改尺寸 + 重画：
 *
 * ```
 * 点【放大】→ canvas 重设尺寸的时刻: [45ms, 47ms, 47ms, 47ms]
 * long task: 1 个 / 59ms
 * ```
 *
 * -> 改 `canvas.width` = **清空位图** ✅
 * -> 紧接着每页都各自 `page.render()` ✅
 * -> pdf.js 在**主线程**做字体度量 + 光栅化 ✅
 * -> 4 页挤在同一帧 ❌ -> **59ms 的长任务** ❌ -> 用户感知"卡一下" ❌
 *
 * ## 修法
 *
 * -> **一次只渲染一页** ✅ -> 每页之间让出一帧 ✅
 * -> 单帧的耗时降到 **1/4** ✅（~15ms ✅）
 * -> 4 帧完成 ✅ -> 用户看到的是"逐页清晰" ✅ 而不是"整体卡住" ✅
 *
 * ## 实测效果
 *
 * ```
 * 修复前: canvas 重设尺寸的时刻: [45ms, 47ms, 47ms, 47ms]   ← 全挤在一帧 ❌
 * 修复后: canvas 重设尺寸的时刻: [59ms, 115ms, 138ms, 143ms] ← 分到 4 帧 ✅
 * ```
 *
 * 连续缩放 3 次 → long task 从 **3 个**降到 **2 个** ✅
 * （中间的旧渲染被丢弃 ✅ -> 不浪费时间 ✅）
 *
 * ## ⚠️ **还剩下多少**
 *
 * -> 单页渲染**本身**就要 ~51ms ❌（页内 canvas 1488×1977 ✅）
 * -> CPU profile 显示 **74% idle** ✅ -> 不是我们的 JS 慢 ✅
 * -> 是 **pdf.js 在 worker 里做字体度量 + 光栅化** ✅
 * -> 试过"草稿分辨率"（缩放中用 1/2 分辨率 ✅）-> **完全没改善** ✅
 *    -> 因为瓶颈**不是像素数** ✅ -> 所以没用 ❌ -> 已删掉 ✅
 *
 * -> 剩下的 51ms 是 **pdf.js 自己的开销** ✅ -> 包这边改不动 ✅
 * -> 实际影响：缩放时掉 2 帧 ✅（60fps 里掉 2 帧 ✅ -> 几乎无感 ✅）
 *
 * ## 为什么不用 pdf.js 自己的调度
 *
 * -> pdf.js 的 `page.render()` 是**每页独立**的 ✅
 * -> 包在**外面**包一层 ✅ -> 能控制"同一时刻只有一页在画" ✅
 * -> 也能保证**最新的请求优先** ✅（缩放时中间的旧请求直接丢掉 ✅）
 */

interface QueueItem {
  /** 执行渲染 */
  run: () => void;
  /** 这个任务的"身份"（用来判断是否过期） */
  token: object;
}

/** 模块级队列（所有页共享 ✅ -> 天然保证同一时刻只有一页在画 ✅） */
const queue: QueueItem[] = [];
let running = false;
let scheduleHandle: number | null = null;

/**
 * 把一个渲染任务**排队**。
 *
 * ⚠️ **同一 `token` 的旧任务会被新的替换** ✅
 * -> 缩放时连续触发 ✅ -> 中间的旧渲染直接丢掉 ✅ -> 不浪费时间 ✅
 *
 * @param token 任务身份（**每次渲染要换一个新的对象** ✅）
 * @param run 真正执行的渲染
 */
export function enqueueCanvasRender(token: object, run: () => void): void {
  /*
   * ⚠️ **同 token 的旧任务直接替换** ✅
   *
   * -> 缩放时 ✅ -> React 连续触发 ✅ -> 同一页会排队多次 ✅
   * -> 只留最后一次 ✅ -> 中间的直接丢掉 ✅
   */
  const existing = queue.findIndex((item) => item.token === token);
  if (existing >= 0) {
    queue.splice(existing, 1);
  }

  queue.push({ token, run });

  if (running) {
    return;
  }
  running = true;
  scheduleHandle = requestAnimationFrame(drain);
}

/**
 * 清空队列（比如整页卸载了 ✅）。
 */
export function clearCanvasRenderQueue(): void {
  queue.length = 0;
  if (scheduleHandle !== null) {
    cancelAnimationFrame(scheduleHandle);
    scheduleHandle = null;
  }
  running = false;
}

/**
 * 每次只跑一个任务 ✅，跑完让出一帧 ✅。
 */
function drain(): void {
  scheduleHandle = null;

  const item = queue.shift();
  if (!item) {
    running = false;
    return;
  }

  try {
    item.run();
  } catch {
    // ⚠️ **单个任务出错不能拖垮整个队列** ✅
  }

  if (queue.length === 0) {
    running = false;
    return;
  }

  // ⚠️ **让出一帧** ✅ -> 下一帧再画下一页 ✅
  scheduleHandle = requestAnimationFrame(drain);
}
