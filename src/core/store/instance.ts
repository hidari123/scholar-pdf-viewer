/**
 * 每实例状态容器 —— 纯 TS，零 React、零依赖。
 *
 * 为什么自己写而不用 valtio/zustand：
 * - 包不该给宿主强加运行时依赖（一个 PDF 查看器不值得拖一个状态库）
 * - `useSyncExternalStore` 是 React 官方方案，够用
 * - 每实例一份 state：多个查看器互不干扰（主项目有"主视图 + 缩略图预览"的需求）
 *
 * 用法：
 * ```ts
 * const store = createViewerStore();
 * store.setState({ scale: 1.5 });     // 写入
 * store.subscribe(listener);          // 订阅
 * store.getState();                   // 读
 * ```
 */

/** 订阅回调 */
export type Listener = () => void;

/** 状态容器 */
export interface Store<T> {
  /** 读当前状态 */
  getState(): T;
  /** 合并写入（浅合并） */
  setState(patch: Partial<T>): void;
  /** 订阅变化，返回取消订阅函数 */
  subscribe(listener: Listener): () => void;
  /** 监听器数量（调试用） */
  readonly listenerCount: number;
}

/** 创建状态容器 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,

    setState: (patch) => {
      // 无变化不通知（避免无谓重渲染）
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }

      state = { ...state, ...patch };
      // 复制一份再遍历：监听器可能在回调里取消订阅
      for (const listener of [...listeners]) {
        listener();
      }
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    get listenerCount() {
      return listeners.size;
    },
  };
}

/** 查看器状态 */
export interface ViewerState {
  /** 当前页（1-based） */
  page: number;
  /** 总页数 */
  numPages: number;
  /** 当前缩放 */
  scale: number;
  /** 缩放模式：'width' = 适配宽度，'fixed' = 固定比例 */
  scaleMode: 'width' | 'fixed';
  /** 可见页（1-based，升序） */
  visiblePages: number[];
  /** 是否正在加载 */
  loading: boolean;
  /** 加载进度（0–1） */
  progress: number;
  /** 错误（统一错误对象） */
  error: unknown | null;
  /** 是否有选区 */
  hasSelection: boolean;
  /** 搜索关键词 */
  searchKeyword: string;
}

/** 查看器初始状态 */
export const INITIAL_VIEWER_STATE: ViewerState = {
  page: 1,
  numPages: 0,
  scale: 1,
  scaleMode: 'width',
  visiblePages: [],
  loading: false,
  progress: 0,
  error: null,
  hasSelection: false,
  searchKeyword: '',
};

/** 创建查看器状态容器 */
export function createViewerStore(initial?: Partial<ViewerState>) {
  return createStore<ViewerState>({ ...INITIAL_VIEWER_STATE, ...initial });
}

/**
 * 缩放锚点保持计算（缩放前后视口中心的内容位置不变）。
 *
 * 公式（方案 §7.3）：
 * `scrollTop_after = (scrollTop_before + anchorY) / scale_before × scale_after - anchorY`
 *
 * 纯函数 → 可单测，也是"缩放不跳动"的核心。
 */
export function anchoredScrollTop(
  scrollTopBefore: number,
  anchorY: number,
  scaleBefore: number,
  scaleAfter: number,
): number {
  if (scaleBefore <= 0 || scaleAfter <= 0) {
    return scrollTopBefore;
  }
  return ((scrollTopBefore + anchorY) / scaleBefore) * scaleAfter - anchorY;
}

/**
 * 当前页计算：在页偏移数组里二分查找（O(log n)）。
 *
 * 主项目原实现每次滚动全量遍历所有页 → 长文档卡顿（方案 §7.3）。
 *
 * @param pageTops 各页顶边（升序，长度 = 总页数 + 1，**最后一项是文档总高的哨兵**）
 * @param scrollTop 当前滚动位置
 */
export function findCurrentPage(pageTops: number[], scrollTop: number): number {
  if (pageTops.length === 0) {
    return 1;
  }

  // 二分：找最后一个 pageTops[i] <= scrollTop 的 i
  let low = 0;
  let high = pageTops.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const top = pageTops[mid];
    if (top !== undefined && top <= scrollTop) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // 末项是"文档总高"的哨兵，不是真实页 → 页码不能超过真实页数
  const totalPages = Math.max(1, pageTops.length - 1);
  return Math.min(Math.max(1, low + 1), totalPages);
}
