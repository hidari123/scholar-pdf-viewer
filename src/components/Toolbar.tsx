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
import type { ToolbarConfig } from '../core/theme';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/**
 * **工具栏配置**。
 *
 * ⚠️ **定义在 `core/theme`**（审计修复）：
 * -> `core/config` 要引用它 -> core **不能反向依赖 components** ❌
 * -> 现在住在 core -> **两边共用同一份** ✅
 *
 * -> 这里**重新导出**，保持对外 API 不变 ✅
 */
export type { ToolbarConfig } from '../core/theme';

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
  /**
   * **宿主注册的语言表**（可添加任意语言）。
   *
   * → 内置 zh / en；宿主用这个加别的语言 ✅
   */
  locales?: LocaleTable;
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
  /**
   * **图标覆盖**（宿主 → 包）。
   *
   * ⚠️ 宿主可以用自己的图标体系（`lucide-react` 等）覆盖内置图标 → 风格统一 ✅
   */
  icons?: Partial<Record<IconName, ReactNode>>;
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
    locales,
    onPageChange,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    onToggleSearch,
    onToggleThumbnails,
    onToggleOutline,
    onPrint,
    icons,
  } = props;

  /** 文案解析（key → 文案） */
  const t = (key: keyof Messages, vars?: Record<string, string | number>) =>
    resolveMessage(locale, key, messages, vars, locales);

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
            <Icon name={'thumbnails'} title={t('thumbnails.title')} overrides={icons} />
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
            <Icon name={'outline'} title={t('outline.title')} overrides={icons} />
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
            <Icon name={'search'} title={t('search.placeholder')} overrides={icons} />
          </button>
        ) : null}
      </div>

      {showPageNav ? (
        <div className="scpdf-toolbar__center">
          <button
            type="button"
            className="scpdf-toolbar__btn scpdf-toolbar__btn--prev"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label={t('page.prev')}
            title={t('page.prev')}
          >
            <Icon name={'chevronLeft'} title={t('page.prev')} overrides={icons} />
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
            className="scpdf-toolbar__btn scpdf-toolbar__btn--next"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label={t('page.next')}
            title={t('page.next')}
          >
            <Icon name={'chevronRight'} title={t('page.next')} overrides={icons} />
          </button>
        </div>
      ) : null}

      {/*
       * ⚠️⚠️ **右侧区域合并成一个**（审计发现两个 bug）。
       *
       * ### ① 打印按钮在 `showZoom` 块里（bug）
       *
       * -> 之前打印按钮**在 `showZoom ? (...)` 里面** ❌
       *   -> 宿主写 `toolbar={{ showZoom: false }}`（不要缩放按钮）❌
       *     -> **打印按钮跟着一起消失** ❌
       *   -> 但"打印"和"缩放"是**两个独立的功能** ❌
       * -> 现在：**独立** ✅
       *
       * ### ② `rightSlot` 也在 `showZoom` 块里（bug）
       *
       * -> 之前宿主插槽**也在 `showZoom` 块里** ❌
       *   -> 宿主写 `showZoom: false` -> **自己的插槽也没了** ❌
       *   -> 宿主只想去掉缩放按钮，结果**自己的按钮也没了** ❌
       *
       * ### ③ 但只能渲染一次
       *
       * -> 拆成两个 div 会让 `rightSlot` **渲染两次** ❌
       *   -> 出现两个"分享"按钮 ❌
       * -> 现在：**一个 div** -> 缩放 + 打印 + 插槽**各一次** ✅
       */}
      <div className="scpdf-toolbar__right">
        {showZoom ? (
          <>
            <button
              type="button"
              className="scpdf-toolbar__btn"
              onClick={onZoomOut}
              disabled={scale <= 0.2}
              aria-label={t('zoom.out')}
              title={t('zoom.out')}
            >
              <Icon name={'zoomOut'} title={t('zoom.out')} overrides={icons} />
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
              <Icon name={'zoomIn'} title={t('zoom.in')} overrides={icons} />
            </button>

            <button
              type="button"
              className="scpdf-toolbar__btn"
              onClick={onFitWidth}
              aria-label={t('zoom.fitWidth')}
              title={t('zoom.fitWidth')}
            >
              <Icon name={'fitWidth'} title={t('zoom.fitWidth')} overrides={icons} />
            </button>

            <button
              type="button"
              className="scpdf-toolbar__btn"
              onClick={onFitPage}
              aria-label={t('zoom.fitPage')}
              title={t('zoom.fitPage')}
            >
              <Icon name={'fitPage'} title={t('zoom.fitPage')} overrides={icons} />
            </button>
          </>
        ) : null}

        {onPrint ? (
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={onPrint}
            aria-label={t('print.title')}
            title={t('print.title')}
          >
            <Icon name={'print'} title={t('print.title')} overrides={icons} />
          </button>
        ) : null}

        {toolbar.rightSlot}
      </div>
    </div>
  );
}
