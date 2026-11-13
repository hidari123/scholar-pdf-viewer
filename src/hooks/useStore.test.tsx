// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore } from '../core/store/instance';
import { shallowEqual, useStore, useStoreSelector } from './useStore';

describe('useStore', () => {
  it('返回 store 当前状态', () => {
    const store = createStore({ count: 5 });
    const { result } = renderHook(() => useStore(store));

    expect(result.current.count).toBe(5);
  });

  it('store 变化时重新渲染并拿到新值', () => {
    const store = createStore({ count: 0 });
    const { result } = renderHook(() => useStore(store));

    act(() => {
      store.setState({ count: 1 });
    });

    expect(result.current.count).toBe(1);
  });
});

describe('useStoreSelector', () => {
  it('只取选中的部分', () => {
    const store = createStore({ a: 1, b: 2 });
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.a));

    expect(result.current).toBe(1);
  });

  it('相关字段变化才更新', () => {
    const store = createStore({ a: 1, b: 2 });
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.a));

    act(() => {
      store.setState({ b: 99 });
    });

    expect(result.current).toBe(1);
  });

  it('选中字段变化时更新', () => {
    const store = createStore({ a: 1, b: 2 });
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.a));

    act(() => {
      store.setState({ a: 5 });
    });

    expect(result.current).toBe(5);
  });

  it('选择器返回新对象时用 isEqual 避免无谓更新', () => {
    const store = createStore({ a: 1, b: 2 });
    // 选择器每次都返回**新对象**（最常见的陷阱用法）
    const selector = (s: { a: number; b: number }) => ({ picked: s.a });
    const { result } = renderHook(() => useStoreSelector(store, selector, shallowEqual));

    const first = result.current;
    expect(first.picked).toBe(1);

    // 只改了 b：选择结果内容没变 → 引用不变 → React 不重渲染
    act(() => {
      store.setState({ b: 99 });
    });

    expect(result.current).toBe(first);
    expect(result.current.picked).toBe(1);
  });

  it('选择的内容变了才更新', () => {
    const store = createStore({ a: 1, b: 2 });
    const selector = (s: { a: number; b: number }) => ({ picked: s.a });
    const { result } = renderHook(() => useStoreSelector(store, selector, shallowEqual));

    act(() => {
      store.setState({ a: 5 });
    });

    expect(result.current.picked).toBe(5);
  });
});

describe('shallowEqual', () => {
  it('相同内容视为相等', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('不同内容视为不等', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it('键数量不同视为不等', () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('同一引用视为相等', () => {
    const obj = { a: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });
});
