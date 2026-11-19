/**
 * OutlinePanel —— 目录面板（左侧）。
 *
 * 目录数据由宿主注入（pdf.js 的 `getOutline()`）→ 包不依赖 pdf.js。
 * 宿主只需提供"页引用 → 页码"的映射，包负责扁平化 + 展开状态 + 渲染。
 */

import { useCallback, useMemo, useState } from 'react';
import type { OutlineItemLike } from '../core/outline/outline';
import { flattenOutline, visibleOutlineItems } from '../core/outline/outline';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** OutlinePanel 参数 */
export interface OutlinePanelProps {
  /** 目录树（宿主注入） */
  outline: OutlineItemLike[] | null;
  /** 页引用 → 页码的映射（宿主注入） */
  pageRefToNumber: (ref: unknown) => number | null;
  /**
   * 映射就绪标记（宿主在映射可用后 +1）。
   *
   * 为什么需要：pdf.js 的 `getPageIndex(ref)` 是**异步**的，
   * 宿主解析页码要时间 → 目录第一次渲染时映射还是空的（项显示为禁用）。
   * 宿主解析完把标记 +1 → 包重新解析 → 目录项变成可跳转。
   */
  resolveToken?: number;
  /** 当前页 */
  currentPage: number;
  /** 点击目录项 → 跳转 */
  onPageSelect: (pageNumber: number) => void;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
  /**
   * **宿主注册的语言表**（可添加任意语言）。
   *
   * → 内置 zh / en；宿主用这个加别的语言 ✅
   */
  locales?: LocaleTable;
}

/**
 * 目录面板。
 *
 * @param props 参数
 */
export function OutlinePanel(props: OutlinePanelProps) {
  const {
    outline,
    pageRefToNumber,
    resolveToken = 0,
    currentPage,
    onPageSelect,
    locale = 'zh',
    messages,
    locales,
  } = props;

  /** 折叠的项 id */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages, undefined, locales),
    [locale, messages, locales],
  );

  /**
   * 扁平化后的目录。
   *
   * resolveToken 参与依赖：宿主解析完页码映射后 +1 → 这里重新解析 →
   * 目录项从"禁用"变成"可跳转"。
   */
  const flatItems = useMemo(() => {
    // 读一下 resolveToken，让它成为真正的依赖（宿主的"映射就绪"信号）
    void resolveToken;
    return flattenOutline(outline, pageRefToNumber);
  }, [outline, pageRefToNumber, resolveToken]);

  /** 可见项（考虑折叠） */
  const visibleItems = useMemo(
    () => visibleOutlineItems(flatItems, collapsedIds),
    [flatItems, collapsedIds],
  );

  /** 切换折叠 */
  const toggle = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (flatItems.length === 0) {
    return null;
  }

  return (
    <aside className="scpdf-panel scpdf-panel--outline" aria-label={t('outline.title')}>
      <h2 className="scpdf-panel__title">{t('outline.title')}</h2>

      <nav className="scpdf-outline">
        {visibleItems.map((item) => {
          const isCollapsed = collapsedIds.has(item.id);
          const hasChildren = flatItems.some((candidate) => candidate.level === item.level + 1);
          const isActive = item.pageNumber === currentPage;

          return (
            <div key={item.id} className="scpdf-outline__row">
              {hasChildren ? (
                <button
                  type="button"
                  className="scpdf-outline__toggle"
                  onClick={() => toggle(item.id)}
                  aria-expanded={!isCollapsed}
                  aria-label={item.title}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="scpdf-outline__toggle scpdf-outline__toggle--empty" />
              )}

              <button
                type="button"
                className={['scpdf-outline__item', isActive ? 'scpdf-outline__item--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ paddingLeft: `${item.level * 12 + 4}px` }}
                onClick={() => {
                  if (item.pageNumber !== null) {
                    onPageSelect(item.pageNumber);
                  }
                }}
                disabled={item.pageNumber === null}
              >
                {item.title}
              </button>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
