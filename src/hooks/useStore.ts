/**
 * React 状态桥 —— 把 core 的纯 TS store 接到 React。
 *
 * 核心是 `useSyncExternalStore`：React 官方方案，无第三方依赖。
 * 订阅在渲染期间是稳定的（useSyncExternalStore 的契约要求），
 * 所以用 `useRef` 缓存订阅函数，避免每次渲染重建订阅（会导致无限重渲染）。
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Store } from '../core/store/instance';

/**
 * 订阅 store，返回当前状态快照。
 *
 * @param store store 实例（通常是 useMemo 出来的稳定引用）
 */
export function useStore<T extends object>(store: Store<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      return store.subscribe(onChange);
    },
    [store],
  );

  const getSnapshot = useCallback(() => store.getState(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 从 store 里选出一部分状态（带浅比较，避免无谓重渲染）。
 *
 * 关键实现点：`useSyncExternalStore` 内部用 `Object.is` 比较快照，
 * 所以选择器每次返回**新对象**时，React 一定认为"变了"→ 无限重渲染。
 * 解决办法：把上次的选择结果缓存起来，`isEqual` 说相等就返回**同一个引用**，
 * React 看到的快照没变 → 不重渲染。
 *
 * @param store store 实例
 * @param selector 选择器（返回的对象每次渲染是新引用时，需配 `isEqual`）
 * @param isEqual 比较函数（默认 `Object.is`）
 */
export function useStoreSelector<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  // 缓存上一次的选择结果
  const cacheRef = useRef<{ value: S; store: Store<T> } | null>(null);

  /**
   * 关键：**不要在 getSnapshot 里更新缓存**。
   *
   * React 会在渲染期间多次调用 getSnapshot（比较新旧快照），
   * 在里面更新缓存会让"本次渲染"读到的是刚算出来的新值 → 与上次渲染的快照不一致 → 判定为"变了" → 无限重渲染。
   *
   * 正确做法：缓存只在**订阅回调**（store 通知）里更新，
   * getSnapshot 是纯读取（相等则返回旧引用）。
   */
  const getSnapshot = useCallback(() => {
    const cached = cacheRef.current;

    if (!cached || cached.store !== store) {
      const value = selector(store.getState());
      cacheRef.current = { value, store };
      return value;
    }

    return cached.value;
  }, [store, selector]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      // 收到通知时先算好新快照并更新缓存（写发生在 getSnapshot 之外）
      const update = () => {
        const next = selector(store.getState());
        const cached = cacheRef.current;
        if (!cached || cached.store !== store || !isEqual(cached.value, next)) {
          cacheRef.current = { value: next, store };
        }
        onChange();
      };

      return store.subscribe(update);
    },
    [store, selector, isEqual],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 浅比较（用于 useStoreSelector） */
export function shallowEqual<S extends Record<string, unknown>>(a: S, b: S): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) => Object.is(a[key], b[key]));
}
