/**
 * Toast —— **轻提示**（照着 antd 的设计）。
 *
 * ## 用户需求
 *
 * > "复制之后需要toast提示用户复制成功"
 *
 * > "需要设计一套toast 失败成功这种 具体照着antd设计"
 *
 * ## 照着 antd 的哪些点
 *
 * | antd 的行为 | 本实现 |
 * |---|---|
 * | 顶部居中，浮在页面上方 | ✅ |
 * | `success` / `error` / `warning` / `info` / `loading` 五种类型 | ✅ |
 * | 图标 + 文案 + 可选操作按钮 | ✅ |
 * | 3 秒自动消失（可关） | ✅ |
 * | 多个 toast **堆叠**（新的在下面） | ✅ |
 * | 淡入 + 轻微上移 | ✅ |
 * | 支持 `Promise` 形态（自动 loading → success/error） | ✅ |
 * | `key` 去重（同 key 更新而不是新增） | ✅ |
 *
 * ## 包的边界
 *
 * → 包只给 **UI + 事件**
 * → 宿主要自己弹 toast → 传 `onToast` 回调 ✅
 * → 包**自己也内置**一套（默认用内置的，宿主不干预就看不到任何东西）✅
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/** toast 的类型（和 antd 对齐） */
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

/** 一条 toast 的内容 */
export interface ToastContent {
  /** 类型 */
  type: ToastType;
  /** 文案 */
  message: string;
  /** 描述（可选，次要文字） */
  description?: string;
  /** 持续时间（毫秒）；`0` = 不自动关闭 */
  duration?: number;
  /** 操作按钮（antd 的 `action`） */
  action?: ReactNode;
  /** 唯一 key（同 key 会更新而不是新增） */
  key?: string;
}

/** 触发一个 toast 的参数 */
export interface ToastOptions {
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  action?: ReactNode;
  key?: string;
}

/**
 * **toast 的控制器**（宿主拿它来弹提示）。
 *
 * ```tsx
 * const toast = usePdfViewerToast();
 * toast.success('已复制');
 * await toast.loading('正在导出…', async () => { ... });
 * ```
 */
export interface ToastController {
  /** 弹一条 toast */
  show: (options: ToastOptions) => string;
  /** 成功 */
  success: (message: string, options?: Partial<ToastOptions>) => string;
  /** 失败 */
  error: (message: string, options?: Partial<ToastOptions>) => string;
  /** 警告 */
  warning: (message: string, options?: Partial<ToastOptions>) => string;
  /** 提示 */
  info: (message: string, options?: Partial<ToastOptions>) => string;
  /** 加载中 */
  loading: (message: string, options?: Partial<ToastOptions>) => string;
  /**
   * **Promise 形态**（照着 antd 的 `message.open`）。
   *
   * ```tsx
   * await toast.loadingPromise('正在复制…', async () => {
   *   await copy();
   *   return '复制成功';
   * });
   * ```
   *
   * → 自动 loading → success / error ✅
   */
  loadingPromise: (
    message: string,
    task: () => Promise<string | undefined>,
    options?: Partial<ToastOptions>,
  ) => Promise<void>;
  /** 关闭一条 */
  close: (key: string) => void;
  /** 全部关闭 */
  clear: () => void;
}

/** Toast 参数 */
export interface ToastProps {
  /** 当前显示的 toast 列表 */
  items: ToastContent[];
  /** 关闭一条 */
  onClose: (key: string) => void;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
}

/** 每种类型对应的图标 */
const TYPE_ICONS: Record<ToastType, IconName> = {
  success: 'check',
  error: 'close',
  warning: 'alert',
  info: 'info',
  loading: 'more',
};

/** 默认时长（ms） */
const DEFAULT_DURATION = 3000;

/**
 * Toast 容器（顶部居中，堆叠显示）。
 *
 * @param props 参数
 */
export function Toast(props: ToastProps) {
  const { items, onClose, icons, locale = 'zh', locales, messages } = props;

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="scpdf-toast" aria-label={t('toast.region')}>
      {items.map((item) => (
        <div
          key={item.key}
          className={`scpdf-toast__item scpdf-toast__item--${item.type}`}
          role="alert"
          aria-live="polite"
        >
          <span className="scpdf-toast__icon">
            <Icon
              name={TYPE_ICONS[item.type]}
              size={16}
              overrides={icons}
              className={item.type === 'loading' ? 'scpdf-toast__icon--spin' : undefined}
            />
          </span>
          <span className="scpdf-toast__body">
            <span className="scpdf-toast__message">{item.message}</span>
            {item.description ? (
              <span className="scpdf-toast__description">{item.description}</span>
            ) : null}
          </span>
          {item.action ? <span className="scpdf-toast__action">{item.action}</span> : null}
          <button
            type="button"
            className="scpdf-toast__close"
            onClick={() => {
              if (item.key) {
                onClose(item.key);
              }
            }}
            title={t('toast.close')}
            aria-label={t('toast.close')}
          >
            <Icon name="close" size={12} overrides={icons} />
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * **toast 控制器**（内部用；包自己弹提示时用）。
 *
 * @param onChange 状态变化回调
 * @param locale 语言
 * @param locales 语言表
 * @param messages 文案覆盖
 * @returns 控制器
 */
export function useToastController(
  onChange: (items: ToastContent[]) => void,
  _locale?: Locale,
  _locales?: LocaleTable,
  _messages?: Partial<Messages>,
): ToastController {
  const [items, setItems] = useState<ToastContent[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  // 状态变化 → 通知外部
  useEffect(() => {
    onChange(items);
  }, [items, onChange]);

  // 卸载时清掉定时器
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) {
        clearTimeout(timer);
      }
      map.clear();
    };
  }, []);

  const close = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(key);
    }
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) {
      clearTimeout(timer);
    }
    timers.current.clear();
    setItems([]);
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      seq.current += 1;
      const key = options.key ?? `toast-${seq.current}`;

      const item: ToastContent = {
        type: options.type,
        message: options.message,
        description: options.description,
        duration: options.duration ?? DEFAULT_DURATION,
        action: options.action,
        key,
      };

      setItems((prev) => {
        // 同 key → 更新（而不是新增）
        const existing = prev.findIndex((x) => x.key === key);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = item;
          return next;
        }
        return [...prev, item];
      });

      // 自动关闭
      const duration = item.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        const timer = setTimeout(() => {
          close(key);
        }, duration);
        timers.current.set(key, timer);
      }

      return key;
    },
    [close],
  );

  const success = useCallback(
    (message: string, options?: Partial<ToastOptions>) =>
      show({ ...options, type: 'success', message }),
    [show],
  );
  const error = useCallback(
    (message: string, options?: Partial<ToastOptions>) =>
      show({ ...options, type: 'error', message }),
    [show],
  );
  const warning = useCallback(
    (message: string, options?: Partial<ToastOptions>) =>
      show({ ...options, type: 'warning', message }),
    [show],
  );
  const info = useCallback(
    (message: string, options?: Partial<ToastOptions>) =>
      show({ ...options, type: 'info', message }),
    [show],
  );
  const loading = useCallback(
    (message: string, options?: Partial<ToastOptions>) =>
      show({ ...options, type: 'loading', message, duration: 0 }),
    [show],
  );

  const loadingPromise = useCallback(
    async (
      message: string,
      task: () => Promise<string | undefined>,
      options?: Partial<ToastOptions>,
    ): Promise<void> => {
      const key = loading(message, { ...options, key: options?.key });
      try {
        const result = await task();
        close(key);
        if (result !== undefined && result !== '') {
          success(result, { ...options, key: options?.key ? `${options.key}-ok` : undefined });
        }
      } catch (err) {
        close(key);
        error(err instanceof Error ? err.message : String(err), {
          ...options,
          key: options?.key ? `${options.key}-err` : undefined,
        });
        throw err;
      }
    },
    [close, error, loading, success],
  );

  return useMemo(
    () => ({ show, success, error, warning, info, loading, loadingPromise, close, clear }),
    [show, success, error, warning, info, loading, loadingPromise, close, clear],
  );
}
