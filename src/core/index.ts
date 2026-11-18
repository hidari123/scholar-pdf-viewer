/**
 * core 层 —— 框架无关（零 React / 零业务 / 零 DOM 顶层访问）
 *
 * 阶段 0：公共类型模型（API 契约）
 * 阶段 1：geometry（坐标换算）/ errors（错误码）/ document（加载）/ cache（字节缓存）
 * 阶段 2+：selection / search / store / text-layer（文本排版）
 */

export * from './annotation';
export * from './cache';
export * from './document';
export * from './errors';
export * from './export';
export * from './geometry';
export * from './highlight';
export * from './outline';
export * from './search';
export * from './selection';
export * from './store';
export * from './text-layer';
export * from './theme';
export * from './thumbnail';
export type * from './types';
export * from './virtualization';
