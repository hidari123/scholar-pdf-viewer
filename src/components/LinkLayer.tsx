/**
 * LinkLayer —— 链接标注层。
 *
 * 在文本层之上、标注层之下：链接要能点，但不能挡住高亮。
 *
 * 安全：URL 由 core 的 `isSafeUrl` 过滤（`javascript:` 之类被丢弃），
 * 内部跳转由宿主处理（包不知道目标页怎么解析）。
 */

import { useMemo } from 'react';
import type { LinkAnnotationLike } from '../core/annotation/links';
import { linkToViewRect, normalizeLinks } from '../core/annotation/links';

/** LinkLayer 参数 */
export interface LinkLayerProps {
  /** 注解列表（宿主注入 pdf.js 的 getAnnotations 结果） */
  annotations: LinkAnnotationLike[] | null;
  /** 页面尺寸（pt） */
  pageSize: { width: number; height: number };
  /** 视口尺寸（px，当前缩放下） */
  viewport: { width: number; height: number };
  /** 点击外部链接（宿主决定怎么开：新窗口 / 应用内） */
  onExternalLink?: (url: string) => void;
  /** 点击内部跳转（宿主解析 dest → 页码） */
  onInternalLink?: (dest: string | unknown[]) => void;
}

/**
 * 链接层。
 *
 * @param props 参数
 */
export function LinkLayer(props: LinkLayerProps) {
  const { annotations, pageSize, viewport, onExternalLink, onInternalLink } = props;

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
        const label = link.url ?? '内部链接';

        return (
          <a
            key={link.id}
            className="scpdf-link"
            href={link.url ?? undefined}
            target={link.url ? '_blank' : undefined}
            rel={link.url ? 'noopener noreferrer' : undefined}
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();

              if (link.url) {
                onExternalLink?.(link.url);
              } else if (link.dest) {
                onInternalLink?.(link.dest);
              }
            }}
            aria-label={label}
            title={label}
          >
            {/* 链接是"透明的可点区域" → 视觉上无内容，但读屏器需要文本 */}
            <span className="scpdf-visually-hidden">{label}</span>
          </a>
        );
      })}
    </div>
  );
}
