/**
 * ThumbnailPanel —— 缩略图面板（左侧）。
 *
 * 设计：
 * - **宿主注入渲染**：`renderThumbnail(pageNumber, width)` 返回图片 URL
 *   → 包不依赖 pdf.js，宿主想用 canvas / 图片 / worker 都行
 * - **懒生成**：只生成可视附近的页（策略在 core/thumbnail）
 * - **LRU 缓存**：数量上限，避免大文档吃内存
 * - **当前页高亮 + 点击跳转**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planThumbnails, ThumbnailCache, thumbnailSpec } from '../core/thumbnail/plan';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** 渲染缩略图的函数（宿主注入） */
export type RenderThumbnail = (pageNumber: number, width: number) => Promise<string | null>;

/** ThumbnailPanel 参数 */
export interface ThumbnailPanelProps {
  /** 总页数 */
  totalPages: number;
  /** 当前页 */
  currentPage: number;
  /** 可视页（虚拟化 hook 提供） */
  visiblePages: number[];
  /** 页面尺寸（pt） */
  pageSizes: { width: number; height: number }[];
  /** 渲染缩略图（宿主注入） */
  renderThumbnail: RenderThumbnail;
  /** 缩略图宽度（px，默认 120） */
  thumbnailWidth?: number;
  /** 缓存上限（默认 100） */
  maxCacheEntries?: number;
  /** 点击缩略图 */
  onPageSelect: (pageNumber: number) => void;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
}

/**
 * 缩略图面板。
 *
 * @param props 参数
 */
export function ThumbnailPanel(props: ThumbnailPanelProps) {
  const {
    totalPages,
    currentPage,
    visiblePages,
    pageSizes,
    renderThumbnail,
    thumbnailWidth = 120,
    maxCacheEntries = 100,
    onPageSelect,
    locale = 'zh',
    messages,
  } = props;

  /**
   * 缩略图缓存（页码 → 图片 URL）。
   *
   * 用 **state** 而不是 ref：缓存内容变了要触发重渲染，
   * 而 React 只认 state/依赖的变化 → 放 ref 里就得手动"点名"依赖（脆弱）。
   */
  const [cache, setCache] = useState(() => new ThumbnailCache(maxCacheEntries));

  /** 正在生成的页（避免重复请求） */
  const generatingRef = useRef(new Set<number>());

  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages),
    [locale, messages],
  );

  /**
   * 制定并执行生成计划。
   *
   * 依赖 visiblePages：可视页变了就重新规划。
   */
  useEffect(() => {
    if (totalPages <= 0 || visiblePages.length === 0) {
      return;
    }

    const plan = planThumbnails({
      totalPages,
      visiblePages,
      cachedPages: cache.pages(),
    });

    if (plan.toRender.length === 0) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      for (const pageNumber of plan.toRender) {
        if (generatingRef.current.has(pageNumber)) {
          continue;
        }
        generatingRef.current.add(pageNumber);

        try {
          const size = pageSizes[pageNumber - 1];
          const spec = size
            ? thumbnailSpec(size.width, size.height, thumbnailWidth)
            : { width: thumbnailWidth, height: thumbnailWidth, scale: 1 };

          const url = await renderThumbnail(pageNumber, spec.width);
          if (cancelled) {
            return;
          }

          if (url) {
            // 写缓存（不可变更新 → 触发重渲染）
            setCache((prev) => {
              const next = new ThumbnailCache(prev.maxEntries);
              for (const page of prev.pages()) {
                const data = prev.get(page);
                if (data !== undefined) {
                  next.set(page, data);
                }
              }
              next.set(pageNumber, url);
              return next;
            });
          }
        } catch {
          // 单页缩略图失败不影响其它页
        } finally {
          generatingRef.current.delete(pageNumber);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [totalPages, visiblePages, pageSizes, renderThumbnail, thumbnailWidth, cache]);

  /** 缩略图列表（页码 + 缓存的图片） */
  const items = useMemo(() => {
    const list: { pageNumber: number; url: string | undefined; height: number }[] = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const size = pageSizes[pageNumber - 1];
      const spec = size
        ? thumbnailSpec(size.width, size.height, thumbnailWidth)
        : { width: thumbnailWidth, height: thumbnailWidth, scale: 1 };

      list.push({
        pageNumber,
        url: cache.get(pageNumber),
        height: spec.height,
      });
    }

    return list;
  }, [totalPages, pageSizes, thumbnailWidth, cache]);

  return (
    <aside className="scpdf-panel scpdf-panel--thumbnails" aria-label={t('thumbnails.title')}>
      <h2 className="scpdf-panel__title">{t('thumbnails.title')}</h2>

      <div className="scpdf-thumbnails">
        {items.map((item) => (
          <button
            key={item.pageNumber}
            type="button"
            className={[
              'scpdf-thumbnail',
              item.pageNumber === currentPage ? 'scpdf-thumbnail--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onPageSelect(item.pageNumber)}
            aria-current={item.pageNumber === currentPage ? 'true' : undefined}
            aria-label={`${t('a11y.page')} ${item.pageNumber}`}
          >
            {item.url ? (
              <img
                className="scpdf-thumbnail__img"
                src={item.url}
                alt=""
                style={{ width: `${thumbnailWidth}px`, height: `${item.height}px` }}
                loading="lazy"
              />
            ) : (
              <span
                className="scpdf-thumbnail__placeholder"
                style={{ width: `${thumbnailWidth}px`, height: `${item.height}px` }}
              />
            )}
            <span className="scpdf-thumbnail__number">{item.pageNumber}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
