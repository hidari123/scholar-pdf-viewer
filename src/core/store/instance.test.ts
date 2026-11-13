import { describe, expect, it, vi } from 'vitest';
import { anchoredScrollTop, createStore, createViewerStore, findCurrentPage } from './instance';

describe('createStore', () => {
  it('读初始状态', () => {
    const store = createStore({ count: 0 });
    expect(store.getState().count).toBe(0);
  });

  it('setState 合并写入', () => {
    const store = createStore({ a: 1, b: 2 });
    store.setState({ b: 3 });
    expect(store.getState()).toEqual({ a: 1, b: 3 });
  });

  it('订阅者收到通知', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('无变化不通知（避免无谓重渲染）', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 0 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('取消订阅后不再通知', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ count: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(store.listenerCount).toBe(0);
  });

  it('监听器在回调里取消订阅不会影响本次通知（快照遍历）', () => {
    const store = createStore({ count: 0 });
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(() => {
      unsubscribeFirst();
    });
    store.subscribe(second);

    store.setState({ count: 1 });

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('createViewerStore', () => {
  it('初始状态含默认值', () => {
    const store = createViewerStore();
    expect(store.getState().page).toBe(1);
    expect(store.getState().scaleMode).toBe('width');
    expect(store.getState().loading).toBe(false);
  });

  it('可覆盖初始值', () => {
    const store = createViewerStore({ page: 5 });
    expect(store.getState().page).toBe(5);
  });

  it('多个实例互不干扰', () => {
    const a = createViewerStore();
    const b = createViewerStore();

    a.setState({ scale: 2 });

    expect(a.getState().scale).toBe(2);
    expect(b.getState().scale).toBe(1);
  });
});

describe('anchoredScrollTop（缩放锚点保持）', () => {
  it('放大后锚点处的内容仍在锚点位置', () => {
    // scrollTop=100, 锚点 y=50, 1x → 2x
    // 内容坐标 c = (100 + 50) / 1 = 150（未缩放单位）
    // 新 scrollTop = 150 * 2 - 50 = 250 → 锚点处的内容没动
    expect(anchoredScrollTop(100, 50, 1, 2)).toBeCloseTo(250);
  });

  it('缩小后锚点处的内容仍在锚点位置', () => {
    // c = (100 + 50) / 2 = 75；新 scrollTop = 75 * 1 - 50 = 25
    expect(anchoredScrollTop(100, 50, 2, 1)).toBeCloseTo(25);
  });

  it('缩放不变时滚动位置不变', () => {
    expect(anchoredScrollTop(100, 50, 1.5, 1.5)).toBeCloseTo(100);
  });

  it('非法缩放返回原值（不崩）', () => {
    expect(anchoredScrollTop(100, 50, 0, 2)).toBe(100);
    expect(anchoredScrollTop(100, 50, 1, 0)).toBe(100);
  });
});

describe('findCurrentPage（当前页二分查找）', () => {
  // 3 页：顶边 0 / 800 / 1600，末尾 2400
  const tops = [0, 800, 1600, 2400];

  it('顶部 → 第 1 页', () => {
    expect(findCurrentPage(tops, 0)).toBe(1);
    expect(findCurrentPage(tops, 500)).toBe(1);
  });

  it('第二页区域 → 第 2 页', () => {
    expect(findCurrentPage(tops, 800)).toBe(2);
    expect(findCurrentPage(tops, 1599)).toBe(2);
  });

  it('第三页区域 → 第 3 页（不会因哨兵项返回第 4 页）', () => {
    expect(findCurrentPage(tops, 1600)).toBe(3);
    // 滚到文档末尾（超过最后一页）也不能返回哨兵对应的"第 4 页"
    expect(findCurrentPage(tops, 9999)).toBe(3);
  });

  it('空数组 → 第 1 页', () => {
    expect(findCurrentPage([], 100)).toBe(1);
  });

  it('页顶边取整后 → 精确命中（浏览器 scrollTop 是整数）', () => {
    /**
     * 真实场景：页顶边累加得到小数（29050.24），
     * 组件层把 pageTops 取整（浏览器 scrollTop 本身也是整数），
     * 于是滚到 tops[16]=29050 → 判定为第 17 页（边界包含）。
     */
    const rounded = [0, 1816, 3631, 5447, 7263];
    expect(findCurrentPage(rounded, 3631)).toBe(3);
    expect(findCurrentPage(rounded, 5447)).toBe(4);
    // 边界前 1px 仍是上一页
    expect(findCurrentPage(rounded, 5446)).toBe(3);
  });
});
