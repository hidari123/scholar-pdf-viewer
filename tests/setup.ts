/**
 * 测试环境准备（所有测试共用）。
 *
 * 这里只做"跨环境都要准备"的事：
 * - jsdom 缺失的浏览器 API 补齐（IntersectionObserver / ResizeObserver / matchMedia）
 * - canvas 的 2d context 替身（jsdom 没有 canvas 实现，组件测试里 canvas 是空壳）
 * - testing-library 的自动清理（每个用例之间清 DOM，否则元素会跨用例累积）
 *
 * 刻意**不**做的事：
 * - 不 mock pdf.js 全局（组件测试用注入的 fake document provider，见 tests/fixtures）
 * - 不改 React 的 act 环境（@testing-library/react 自带）
 */

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 每个用例后清理 DOM（testing-library 默认只在 globals 模式下自动清理，这里显式做）
afterEach(() => {
  cleanup();
});

/** 造一个极简 IntersectionObserver 替身（记录回调，可手动触发） */
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  /** 观察中的元素（测试可查） */
  readonly observed = new Set<Element>();

  constructor(readonly callback: IntersectionObserverCallback) {}

  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** 造一个极简 ResizeObserver 替身 */
class FakeResizeObserver {
  readonly observed = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {}

  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
}

/** 补齐 jsdom 缺失的 API（存在则不覆盖） */
function polyfill(): void {
  const globalRef = globalThis as unknown as Record<string, unknown>;

  if (typeof globalRef.IntersectionObserver === 'undefined') {
    globalRef.IntersectionObserver = FakeIntersectionObserver;
  }

  if (typeof globalRef.ResizeObserver === 'undefined') {
    globalRef.ResizeObserver = FakeResizeObserver;
  }

  if (typeof globalRef.matchMedia === 'undefined') {
    globalRef.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // canvas.getContext('2d') 在 jsdom 里没有实现（会抛 "not implemented"）→ 组件会崩。
  // 这里给一个最小替身：只提供组件真正用到的方法（测量、清理、状态）。
  const HTMLCanvasElementCtor = globalRef.HTMLCanvasElement as
    | (new () => HTMLCanvasElement)
    | undefined;

  if (HTMLCanvasElementCtor) {
    const proto = HTMLCanvasElementCtor.prototype as unknown as Record<string, unknown>;
    // 直接覆盖（不探测原实现是否可用 —— jsdom 的探测本身就会抛）
    proto.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
      if (kind !== '2d') {
        return null;
      }
      // 记录 font（文本层要用 measureText 实测宽度 → 必须随字号变化）
      const state = { font: '10px sans-serif', textBaseline: 'alphabetic' };

      return {
        canvas: this,
        get fillStyle(): string {
          return '#000000';
        },
        set fillStyle(_value: string) {},
        get font(): string {
          return state.font;
        },
        set font(value: string) {
          state.font = value;
        },
        get textBaseline(): string {
          return state.textBaseline;
        },
        set textBaseline(value: string) {
          state.textBaseline = value;
        },
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        putImageData: () => {},
        save: () => {},
        restore: () => {},
        scale: () => {},
        translate: () => {},
        setTransform: () => {},
        transform: () => {},
        /**
         * 宽度必须随字号变化 —— 文本层的 scaleX 依赖它
         * （`scaleX = PDF 宽度 / 浏览器实测宽度`）。
         * 固定返回 `text.length * 6` 会让所有字号测出同一个宽度 → 缩放比失真。
         */
        measureText: (text: string) => {
          const match = /(\d+(?:\.\d+)?)px/.exec(state.font);
          const fontSize = match?.[1] ? Number.parseFloat(match[1]) : 10;
          return {
            width: text.length * fontSize * 0.5,
            fontBoundingBoxAscent: fontSize * 0.8,
            fontBoundingBoxDescent: fontSize * 0.2,
          };
        },
      };
    };
  }
}

polyfill();
