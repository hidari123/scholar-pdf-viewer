/**
 * StickyNoteLayer —— **批注（小便签）**的 DOM 覆盖层。
 *
 * ## 用户需求
 *
 * > "第一个是添加批注 具体添加方式和wps的批注一样 也是加一个小便签纸一样的在上面
 * >  hover会展示出来"
 *
 * > "如果要批注的内容在同一行呢 别的软件是怎么处理的这个逻辑 你调研一下
 * >  目前这两个批注会叠在一起 我认为可以只出现一个图标 然后悬浮在图标上可以选择批注几"
 *
 * → 高亮块旁边出现一个**小便签图标**
 * → **hover** → 弹出**便签内容**（带小尾巴的纸片）
 * → **同一行的多个批注 → 合并成一个图标**（带数量角标）
 * → **hover 合并的图标 → 弹出选择列表**（"选择批注 N"）
 *
 * ## 为什么用 DOM 而不是 canvas
 *
 * - **可 hover / 可点击**（DOM 天然支持）
 * - 便签内容需要**换行 / 滚动** → canvas 做不到
 * - 颜色走 CSS 变量 → 宿主可换肤
 */

import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { AnnotationGroup } from '../core/annotation/annotation-groups';
import { groupAnnotations } from '../core/annotation/annotation-groups';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import { STICKY_NOTE_SIZE, stickyNotePosition } from '../core/annotation/sticky-note';
import type { HighlightRecord, ViewRect } from '../core/types';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { RichTextPreview } from './RichTextPreview';

/** StickyNoteLayer 参数 */
export interface StickyNoteLayerProps {
  /** 页码 */
  pageNumber: number;
  /** 批注（受控） */
  annotations: AnnotationRecord[];
  /** 高亮（用来算便签的锚点位置） */
  highlights: HighlightRecord[];
  /** 当前视口尺寸（归一化坐标的参考） */
  viewport: { width: number; height: number };
  /** 点击便签（宿主实现：打开编辑框等） */
  onAnnotationClick?: (annotation: AnnotationRecord) => void;
  /** 鼠标进入便签 */
  onAnnotationHover?: (annotation: AnnotationRecord | null) => void;
  /**
   * **点"编辑"**（宿主实现：打开编辑框）。
   *
   * → 宿主没传 → **不显示编辑按钮** ✅（"宿主没配就不渲染"）
   * → 第二个参数是**按钮元素** -> 宿主可以拿它算弹窗锚点 ✅
   */
  onAnnotationEdit?: (annotation: AnnotationRecord, element?: HTMLElement) => void;
  /**
   * **点"展开"**（宿主实现：打开详情）。
   *
   * → 宿主没传 → **不显示展开按钮** ✅
   */
  onAnnotationExpand?: (annotation: AnnotationRecord) => void;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /**
   * **语言**（用于文案）。
   *
   * ⚠️ **批注的所有文案都要走 i18n**（用户需求：
   * "编辑批注啊 title啊 取消保存啊 这种文字都是要设置两套语言的哈"）。
   */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
}

/**
 * 批注覆盖层。
 *
 * @param props 参数
 */
export function StickyNoteLayer(props: StickyNoteLayerProps) {
  const {
    pageNumber,
    annotations,
    highlights,
    viewport,
    onAnnotationClick,
    onAnnotationHover,
    onAnnotationEdit,
    onAnnotationExpand,
    icons,
    locale = 'zh',
    locales,
    messages,
  } = props;

  /**
   * **文案解析**（走 i18n -> 跟着语言切换）。
   */
  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  /** 当前 hover 的批注 id（控制便签内容显示） */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /** 当前 hover 的**组**（合并的批注 → 显示选择列表） */
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);

  /** 高亮在页内的矩形（用来给便签找锚点） */
  const highlightRects = useMemo(() => {
    const map = new Map<string, ViewRect[]>();
    for (const highlight of highlights) {
      if (highlight.position.pageNumber !== pageNumber) {
        continue;
      }
      const list: ViewRect[] = [];
      for (const norm of highlight.position.rects) {
        const ratioX = norm.width > 0 ? viewport.width / norm.width : 1;
        const ratioY = norm.height > 0 ? viewport.height / norm.height : 1;
        const left = norm.x1 * ratioX;
        const top = norm.y1 * ratioY;
        const right = norm.x2 * ratioX;
        const bottom = norm.y2 * ratioY;
        list.push({
          left: Math.min(left, right),
          top: Math.min(top, bottom),
          width: Math.abs(right - left),
          height: Math.abs(bottom - top),
          pageNumber,
        });
      }
      if (list.length > 0) {
        map.set(highlight.id, list);
      }
    }
    return map;
  }, [highlights, pageNumber, viewport.width, viewport.height]);

  /** 每条批注的锚点（页内矩形） */
  const anchors = useMemo(() => {
    const map = new Map<string, { left: number; top: number; width: number; height: number }>();

    for (const annotation of annotations) {
      const rects = highlightRects.get(annotation.highlightId);
      if (!rects || rects.length === 0) {
        continue;
      }
      // 锚点 = 高亮的**并集**（多行高亮 → 便签在整块的高亮右上角）
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const r of rects) {
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.left + r.width);
        bottom = Math.max(bottom, r.top + r.height);
      }
      map.set(annotation.id, { left, top, width: right - left, height: bottom - top });
    }

    return map;
  }, [annotations, highlightRects]);

  /**
   * **把挤在一起的批注合并成组**（用户需求）。
   *
   * → 同一行 + 水平相距不远 → 一组 → **只渲染一个图标**
   */
  const groups = useMemo<AnnotationGroup[]>(() => {
    const items = [];
    for (const annotation of annotations) {
      const anchor = anchors.get(annotation.id);
      if (!anchor) {
        continue;
      }
      items.push({ id: annotation.id, ...anchor });
    }
    return groupAnnotations(items);
  }, [annotations, anchors]);

  /** 每组里第一条批注的记录（用来渲染内容和触发事件） */
  const annotationById = useMemo(() => {
    const map = new Map<string, AnnotationRecord>();
    for (const annotation of annotations) {
      map.set(annotation.id, annotation);
    }
    return map;
  }, [annotations]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-sticky-notes" aria-hidden="false">
      {groups.map((group) => {
        const first = group.annotations[0];
        const firstRecord = first ? annotationById.get(first.id) : undefined;
        if (!first || !firstRecord) {
          return null;
        }

        // 组里只有一条 → 普通便签；有多条 → 合并图标（带角标）
        const isGroup = group.annotations.length > 1;
        const isHovered = hoveredGroupKey === group.key;

        // 图标位置（用整组的并集）
        const pos = stickyNotePosition(firstRecord, group.anchor, viewport);
        if (!pos) {
          return null;
        }

        return (
          <span
            key={group.key}
            className="scpdf-sticky-note"
            data-group={isGroup ? 'true' : 'false'}
            style={{ left: pos.left, top: pos.top }}
          >
            <button
              type="button"
              className="scpdf-sticky-note__icon"
              style={{ width: STICKY_NOTE_SIZE, height: STICKY_NOTE_SIZE }}
              title={
                isGroup
                  ? t('annotation.selectGroup', { count: group.annotations.length })
                  : t('annotation.title')
              }
              aria-label={
                isGroup
                  ? t('annotation.selectGroup', { count: group.annotations.length })
                  : t('annotation.withContent', { content: firstRecord.content.slice(0, 20) })
              }
              onMouseEnter={() => {
                setHoveredGroupKey(group.key);
                setHoveredId(first.id);
                if (!isGroup) {
                  onAnnotationHover?.(firstRecord);
                }
              }}
              onMouseLeave={(event) => {
                /*
                 * ⚠️⚠️ **鼠标移到内容框上时不能清掉 hover 状态**（用户反馈：
                 * "我现在移动鼠标到批注的文字上面 框就消失了"）。
                 *
                 * → 内容框是图标的**兄弟节点**（position: absolute，图标右边）
                 * → 鼠标从图标移到内容框 → 图标触发 mouseleave
                 * → 如果这时清状态 → **内容框立刻消失** → 用户根本点不到里面的按钮 ❌
                 *
                 * → 修法：判断"鼠标是不是移到相关的兄弟节点上" → 是就不清 ✅
                 * → （用 `relatedTarget` 判断，比 `contains` 更准）
                 */
                const related = event.relatedTarget as Node | null;
                if (related && event.currentTarget.parentElement?.contains(related)) {
                  return;
                }
                setHoveredGroupKey(null);
                setHoveredId(null);
                onAnnotationHover?.(null);
              }}
              onFocus={() => {
                setHoveredGroupKey(group.key);
                setHoveredId(first.id);
              }}
              onBlur={() => {
                setHoveredGroupKey(null);
                setHoveredId(null);
              }}
              onClick={() => {
                /*
                 * ⚠️ **合并的组 → 不直接打开**，而是让用户从列表里选。
                 *
                 * → 否则多个批注没法区分（用户需求："悬浮在图标上可以选择批注几"）
                 */
                if (isGroup) {
                  return;
                }
                onAnnotationClick?.(firstRecord);
              }}
            >
              <Icon name="stickyNote" size={STICKY_NOTE_SIZE} overrides={icons} />

              {/* 数量角标（合并时显示） */}
              {isGroup ? (
                <span className="scpdf-sticky-note__badge">{group.annotations.length}</span>
              ) : null}
            </button>

            {/*
              **hover 才显示**内容（WPS 的做法）。

              ⚠️ 用 `aria-hidden` + `visibility` 而不是 `display:none`
              → 保留在无障碍树里（读屏软件能读到）。

              ⚠️ **内容要按富文本渲染**（用户需求：
              "展示的时候要展示富文本形式的 不要带上标签 翻译成html展示出来"）。
              → 之前直接渲染 `content`（HTML 字符串）→ 用户看到 `<p>...</p>` ❌
              → 现在用 `<RichTextPreview>` → **排版好的富文本** ✅
            */}
            {!isGroup ? (
              <span
                className="scpdf-sticky-note__content"
                data-visible={hoveredId === first.id ? 'true' : 'false'}
                role="note"
                /*
                 * ⚠️ **鼠标进入内容框 → 保持 hover 状态**（用户反馈：
                 * "移动鼠标到批注的文字上面 框就消失了"）。
                 *
                 * → 鼠标从图标移过来时，图标已经触发 mouseleave
                 * → 这里再把它设回来 → **框不会消失** ✅
                 * → 用户能点里面的"编辑 / 展开"按钮 ✅
                 */
                onMouseEnter={() => {
                  setHoveredGroupKey(group.key);
                  setHoveredId(first.id);
                }}
                onMouseLeave={(event) => {
                  const related = event.relatedTarget as Node | null;
                  if (related && event.currentTarget.parentElement?.contains(related)) {
                    return;
                  }
                  setHoveredGroupKey(null);
                  setHoveredId(null);
                  onAnnotationHover?.(null);
                }}
              >
                {/* 富文本正文：渲染成 HTML，不是标签（用户需求） */}
                <RichTextPreview className="scpdf-sticky-note__text" html={firstRecord.content} />

                {/* 操作按钮：宿主没传回调就不渲染 */}
                {onAnnotationEdit || onAnnotationExpand ? (
                  <span className="scpdf-sticky-note__actions">
                    {onAnnotationEdit ? (
                      <button
                        type="button"
                        className="scpdf-sticky-note__action"
                        aria-label={t('annotation.edit')}
                        title={t('annotation.edit')}
                        onClick={(event) => {
                          event.stopPropagation();
                          /*
                           * ⚠️ **把按钮元素传出去**（用来算弹窗的锚点）。
                           *
                           * → 用户需求："富文本点了编辑 怎么富文本编辑框还在文档最上面啊
                           *   要出现在视野里啊 就点的旁边" ✅
                           * -> 宿主用它的 `getBoundingClientRect()` 当锚点 ✅
                           */
                          onAnnotationEdit(firstRecord, event.currentTarget);
                        }}
                      >
                        <Icon name="edit" size={13} overrides={icons} />
                      </button>
                    ) : null}
                    {onAnnotationExpand ? (
                      <button
                        type="button"
                        className="scpdf-sticky-note__action"
                        aria-label={t('annotation.expand')}
                        title={t('annotation.expand')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAnnotationExpand(firstRecord);
                        }}
                      >
                        <Icon name="more" size={13} overrides={icons} />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            ) : null}

            {/* 合并组的"选择列表"（hover 时显示） */}
            {isGroup ? (
              <span
                className="scpdf-sticky-note__picker"
                data-visible={isHovered ? 'true' : 'false'}
                role="menu"
              >
                <span className="scpdf-sticky-note__picker-title">
                  选择批注（{group.annotations.length}）
                </span>
                {group.annotations.map((item) => {
                  const record = annotationById.get(item.id);
                  if (!record) {
                    return null;
                  }
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="scpdf-sticky-note__picker-item"
                      role="menuitem"
                      onMouseEnter={() => {
                        setHoveredId(item.id);
                        onAnnotationHover?.(record);
                      }}
                      onMouseLeave={() => {
                        setHoveredId(null);
                        onAnnotationHover?.(null);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAnnotationClick?.(record);
                      }}
                    >
                      {record.content.slice(0, 60) || t('annotation.empty')}
                    </button>
                  );
                })}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
