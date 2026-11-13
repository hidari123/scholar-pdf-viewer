/**
 * Toolbar —— 内置工具栏（零 UI 库依赖）。
 *
 * 设计要点：
 * - **slots**：宿主可以在左右塞任意内容（历史文档、分享按钮…），
 *   不需要包提供这些业务入口（v2 边界：业务 UI 在宿主）
 * - 每一块都能单独关闭（`features` / `toolbar` 配置）
 * - 无障碍：所有按钮有 aria-label，键盘可达
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** 工具栏配置 */
export interface ToolbarConfig {
  /** 显示翻页 */
  showPageNav?: boolean;
  /** 显示缩放 */
  showZoom?: boolean;
  /** 显示搜索 */
  showSearch?: boolean;
  /** 显示缩略图 */
  showThumbnails?: boolean;
  /** 显示目录 */
  showOutline?: boolean;
  /** 左侧插槽（宿主任意内容） */
  leftSlot?: ReactNode;
  /** 右侧插槽（宿主任意内容） */
  rightSlot?: ReactNode;
}

/** Toolbar 参数 */
export interface ToolbarProps {
  /** 工具栏配置（对应 PdfViewer 的 toolbar prop） */
  toolbar?: ToolbarConfig;
  /** 当前页 */
  page: number;
  /** 总页数 */
  totalPages: number;
  /** 当前缩放 */
  scale: number;
  /** 语言 */
  locale: Locale;
  /** 文案覆盖 */
  messages?: Parameters<typeof resolveMessage>[2];
  /** 翻页 */
  onPageChange: (page: number) => void;
  /** 缩放 */
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  /** 打开搜索 */
  onToggleSearch?: () => void;
  /** 打开缩略图 */
  onToggleThumbnails?: () => void;
  /** 打开目录 */
  onToggleOutline?: () => void;
  /** 打印 */
  onPrint?: () => void;
}

/**
 * 内置工具栏。
 *
 * @param props 参数
 */
export function Toolbar(props: ToolbarProps) {
  const {
    toolbar = {},
    page,
    totalPages,
    scale,
    locale,
    messages,
    onPageChange,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    onToggleSearch,
    onToggleThumbnails,
    onToggleOutline,
    onPrint,
  } = props;

  /** 文案解析（key → 文案） */
  const t = (key: keyof Messages, vars?: Record<string, string | number>) =>
    resolveMessage(locale, key, messages, vars);

  const showPageNav = toolbar.showPageNav !== false;
  const showZoom = toolbar.showZoom !== false;
  const showSearch = toolbar.showSearch !== false;
  const showThumbnails = toolbar.showThumbnails !== false;
  const showOutline = toolbar.showOutline !== false;

  /** 页码输入框的草稿值（用户正在输入的内容） */
  const [draftPage, setDraftPage] = useState(String(page));

  // 外部页码变化时同步草稿（翻页后输入框要跟着更新）
  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  return (
    <div className="scpdf-toolbar" role="toolbar" aria-label="PDF toolbar">
      <div className="scpdf-toolbar__left">
        {toolbar.leftSlot}

        {showThumbnails && onToggleThumbnails ? (
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onToggleThumbnails}
            aria-label={t('thumbnails.title')}
            title={t('thumbnails.title')}
          >
            <ScpdfIcon name="thumbnails" />
          </button>
        ) : null}

        {showOutline && onToggleOutline ? (
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onToggleOutline}
            aria-label={t('outline.title')}
            title={t('outline.title')}
          >
            <ScpdfIcon name="outline" />
          </button>
        ) : null}

        {showSearch && onToggleSearch ? (
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onToggleSearch}
            aria-label={t('search.placeholder')}
            title={t('search.placeholder')}
          >
            <ScpdfIcon name="search" />
          </button>
        ) : null}
      </div>

      {showPageNav ? (
        <div className="scpdf-toolbar__center">
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="上一页"
          >
            <ScpdfIcon name="prev" />
          </button>

          <label className="scpdf-toolbar__pager">
            {/*
              页码输入框用"草稿值"（本地 state）：
              直接受控（value={page}）的话，用户没法输入 —— 每次按键都会被
              外部值覆盖回去（清空后立刻变回当前页），这是真实体验缺陷。
              草稿值 + 合法时才提交，两全其美。
            */}
            <input
              type="number"
              className="scpdf-toolbar__page-input"
              value={draftPage}
              min={1}
              max={totalPages}
              onChange={(event) => {
                const raw = event.target.value;
                setDraftPage(raw);

                const next = Number(raw);
                if (raw !== '' && Number.isFinite(next) && next >= 1 && next <= totalPages) {
                  onPageChange(next);
                }
              }}
              onBlur={() => {
                // 失焦时非法值回落成当前页
                setDraftPage(String(page));
              }}
              aria-label={t('page.of', { page, total: totalPages })}
            />
            <span className="scpdf-toolbar__page-total">/ {totalPages}</span>
          </label>

          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="下一页"
          >
            <ScpdfIcon name="next" />
          </button>
        </div>
      ) : null}

      {showZoom ? (
        <div className="scpdf-toolbar__right">
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onZoomOut}
            disabled={scale <= 0.2}
            aria-label={t('zoom.out')}
            title={t('zoom.out')}
          >
            <ScpdfIcon name="zoomOut" />
          </button>

          <span className="scpdf-toolbar__scale" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onZoomIn}
            disabled={scale >= 2.5}
            aria-label={t('zoom.in')}
            title={t('zoom.in')}
          >
            <ScpdfIcon name="zoomIn" />
          </button>

          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onFitWidth}
            aria-label={t('zoom.fitWidth')}
            title={t('zoom.fitWidth')}
          >
            <ScpdfIcon name="fitWidth" />
          </button>

          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onFitPage}
            aria-label={t('zoom.fitPage')}
            title={t('zoom.fitPage')}
          >
            <ScpdfIcon name="fitPage" />
          </button>

          {onPrint ? (
            <button
              type="button"
              className="scpdf-toolbar__btn"
              onClick={onPrint}
              aria-label={t('print.title')}
              title={t('print.title')}
            >
              <ScpdfIcon name="print" />
            </button>
          ) : null}

          {toolbar.rightSlot}
        </div>
      ) : null}
    </div>
  );
}

/** 图标名 */
type IconName =
  | 'prev'
  | 'next'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'fitPage'
  | 'search'
  | 'thumbnails'
  | 'outline'
  | 'print';

/**
 * 内联 SVG 图标（不引图标库 → 保持零依赖 + 可换肤）。
 *
 * @param props 图标名与尺寸
 */
function ScpdfIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'prev':
      return (
        <svg {...common}>
          <title>Previous page</title>
          <path d="M10 3 5 8l5 5" />
        </svg>
      );
    case 'next':
      return (
        <svg {...common}>
          <title>Next page</title>
          <path d="M6 3l5 5-5 5" />
        </svg>
      );
    case 'zoomIn':
      return (
        <svg {...common}>
          <title>Zoom in</title>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14M5 7h4M7 5v4" />
        </svg>
      );
    case 'zoomOut':
      return (
        <svg {...common}>
          <title>Zoom out</title>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14M5 7h4" />
        </svg>
      );
    case 'fitWidth':
      return (
        <svg {...common}>
          <title>Fit width</title>
          <path d="M2 3v10M14 3v10M5 8h6" />
        </svg>
      );
    case 'fitPage':
      return (
        <svg {...common}>
          <title>Fit page</title>
          <rect x="3.5" y="2.5" width="9" height="11" rx="1" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <title>Search</title>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
      );
    case 'thumbnails':
      return (
        <svg {...common}>
          <title>Thumbnails</title>
          <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
          <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
          <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
          <rect x="9.5" y="9.5" width="4" height="4" rx="0.5" />
        </svg>
      );
    case 'outline':
      return (
        <svg {...common}>
          <title>Outline</title>
          <path d="M3 4h10M5 8h8M7 12h6" />
        </svg>
      );
    case 'print':
      return (
        <svg {...common}>
          <title>Print</title>
          <path d="M4.5 6V2.5h7V6M4.5 12H3V7h10v5h-1.5M4.5 10h7v3.5h-7z" />
        </svg>
      );
    default:
      return null;
  }
}
