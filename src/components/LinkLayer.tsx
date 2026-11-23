/**
 * LinkLayer —— 链接标注层。
 *
 * 在文本层之上、标注层之下：链接要能点，但不能挡住高亮。
 *
 * 安全：URL 由 core 的 `isSafeUrl` 过滤（`javascript:` 之类被丢弃），
 * 内部跳转由宿主处理（包不知道目标页怎么解析）。
 *
 * ⚠️⚠️ **链接层必须对鼠标"透明"**（`pointer-events: none`）——
 * 这是 pdf.js v6 的做法（`.annotationLayer { pointer-events: none }`）。
 *
 * 真实 PDF 实测（用户反馈"框选没反应"）：
 * 摘要里有个 GitHub 链接（`https://github.com/datamillab/A2E`），
 * 从它上面开始拖选 → **选区完全出不来**。
 *
 * 根因：`<a>` 元素（`pointer-events: auto`）**接管了鼠标事件**
 *      → 浏览器的拖动被当成"拖拽链接" → 文本层根本收不到选区。
 *
 * → 本包的做法：**链接层整体不接收鼠标事件**，
 *   而是在**容器**上做事件委托：点击时按坐标命中某个链接矩形 → 才当链接处理。
 *   （拖动时根本不判定链接 → 文本层正常选区。）
 */

import { useCallback, useMemo } from 'react';
import type { LinkAnnotationLike } from '../core/annotation/links';
import { linkToViewRect, normalizeLinks } from '../core/annotation/links';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** LinkLayer 参数 */
export interface LinkLayerProps {
  /** 注解列表（宿主注入 pdf.js 的 getAnnotations 结果） */
  annotations: LinkAnnotationLike[] | null;
  /** 页面尺寸（pt） */
  pageSize: { width: number; height: number };
  /** 视口尺寸（px，当前缩放下） */
  viewport: { width: number; height: number };
  /** 页码（内部跳转要告诉宿主是哪一页） */
  pageNumber: number;
  /** 点击外部链接（宿主决定怎么开：新窗口 / 应用内） */
  onExternalLink?: (url: string) => void;
  /** 点击内部跳转（宿主解析 dest → 页码） */
  onInternalLink?: (dest: string | unknown[], pageNumber: number) => void;
  /**
   * **语言**（用于文案）。
   *
   * ⚠️ 用户需求："这种文字都是要设置两套语言的哈 内置在包内"
   */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
}

/**
 * 链接层。
 *
 * @param props 参数
 */
export function LinkLayer(props: LinkLayerProps) {
  const {
    annotations,
    pageSize,
    viewport,
    pageNumber,
    onExternalLink,
    onInternalLink,
    locale = 'zh',
    locales,
    messages,
  } = props;

  /** 文案解析（走 i18n） */
  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  /** 归一化后的链接 */
  const links = useMemo(
    () => normalizeLinks(annotations, pageSize.width, pageSize.height),
    [annotations, pageSize.width, pageSize.height],
  );

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-links">
      {links.map((link) => {
        const rect = linkToViewRect(link, viewport.width, viewport.height);
        const label = link.url ?? t('link.internal');

        return (
          /*
           * ⚠️ **这里渲染成 `span` 而不是 `a`**。
           *
           * 理由：`<a>` 会接管拖动（浏览器当成"拖拽链接"）
           *      → 从链接上拖选选不出文字。
           *
           * `<a>` 的语义（可聚焦、可右键"在新标签页打开"、可复制链接地址）
           * 改用 **`role="link"` + `tabIndex` + `onKeyDown`** 保留，
           * 点击由**容器上的事件委托**处理（见 `PdfViewer` 的 `handleContainerClick`）。
           *
           * ⚠️ biome 的 `useSemanticElements` 建议用 `<a>` ——
           *    但 `<a>` 正是**吞掉拖选**的元凶 → 这里必须用 `span` + `role="link"`。
           */
          // biome-ignore lint/a11y/useSemanticElements: <a> 会吞掉拖选（链接层必须对鼠标透明）
          <span
            key={link.id}
            className="scpdf-link"
            role="link"
            tabIndex={0}
            aria-label={label}
            title={label}
            data-link-id={link.id}
            /*
             * ⚠️ 把**跳转目标**挂在 DOM 上（而不是回头查注解列表）。
             *
             * 注解列表是"归一化前的原始数据"，里面没有 id
             * （id 是 `normalizeLinks` 生成的）→ 没法按 id 反查。
             */
            data-link-url={link.url ?? undefined}
            data-link-dest={link.dest ? JSON.stringify(link.dest) : undefined}
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (link.url) {
                  onExternalLink?.(link.url);
                } else if (link.dest) {
                  onInternalLink?.(link.dest, pageNumber);
                }
              }
            }}
          />
        );
      })}
    </div>
  );
}
