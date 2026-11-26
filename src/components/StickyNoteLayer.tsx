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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationGroup } from '../core/annotation/annotation-groups';
import { groupAnnotations } from '../core/annotation/annotation-groups';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import { STICKY_NOTE_SIZE, stickyNotePosition } from '../core/annotation/sticky-note';
import { computeStickyNoteContentPosition } from '../core/annotation/sticky-note-content-position';
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
   * → 宿主没传 → **不显示编辑按钮**  （"宿主没配就不渲染"）
   * → 第二个参数是**按钮元素** -> 宿主可以拿它算弹窗锚点
   */
  onAnnotationEdit?: (annotation: AnnotationRecord, element?: HTMLElement) => void;
  /**
   * **点"展开"**（宿主实现：打开详情）。
   *
   * → 宿主没传 → **不显示展开按钮**
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

  /*
   * ⚠️ **内容框的视口坐标**（`position: fixed` 用）。
   *
   * → 内容框原来是页内绝对定位 → 写死 `left: 26px`
   *   → 便签在页边角时**超出页面** → 被 `overflow: hidden` 裁掉
   * → 现在改成 fixed → 坐标由 JS 算（和主题菜单、选区浮层同一套）
   *
   * → 图标位置用 `getBoundingClientRect()` 量（视口坐标）
   * → 容器滚动了 → 图标跟着动 → 但坐标是**量出来的** → 不会过期
   */
  const [contentPos, setContentPos] = useState<{ left: number; top: number } | null>(null);
  /** 用来量位置的图标元素（按组 key 存） */
  const iconRefs = useRef(new Map<string, HTMLButtonElement>());

  /*
   * ⚠️⚠️ **关闭的延迟定时器**（用户反馈：
   * "鼠标一移开批注按钮 批注内容区域就消失了 鼠标一移开就消失了"）。
   *
   * ### 问题
   *
   * -> 鼠标从**图标**移向**内容框** -> 图标触发 \`mouseleave\` ❌
   * -> 之前**立刻**清掉 hover 状态 -> 内容框**瞬间消失** ❌
   *    -> 用户根本**点不到**里面的按钮 ❌
   *    -> 用户反馈："试了很多次都失败了 无法hover上"
   *
   * ### 修法：**延迟关闭**
   *
   * -> \`mouseleave\` -> **等 200ms** 再关
   * -> 这 200ms 里如果鼠标**进入了**内容框 -> **取消关闭**
   *    -> 内容框**不会消失**
   * -> 鼠标真的走了 -> 200ms 后**关掉**  （不会粘着不走）
   */
  const closeTimerRef = useRef(0);

  /*
   * ⚠️ **算内容框的位置**（视口坐标）。
   *
   * → 图标位置用 `getBoundingClientRect()` 量
   * → 内容框是 `position: fixed` → 坐标直接就是视口坐标
   *
   * ⚠️ **内容框的尺寸**：
   * → CSS 里是 `max-width: 260px` / `max-height: 220px`
   * → 实际宽度取决于内容 → 量**渲染后**的盒子
   * → 量不到（还没渲染）→ 用 CSS 的上限兜底
   */
  const updateContentPos = useCallback((icon: HTMLElement, content: HTMLElement | null) => {
    const iconRect = icon.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const width = contentRect?.width || 260;
    const height = contentRect?.height || 220;

    setContentPos(
      computeStickyNoteContentPosition({
        icon: {
          left: iconRect.left,
          top: iconRect.top,
          width: iconRect.width,
          height: iconRect.height,
        },
        size: { width, height },
        viewport: {
          width: typeof window === 'undefined' ? 0 : window.innerWidth,
          height: typeof window === 'undefined' ? 0 : window.innerHeight,
        },
      }),
    );
  }, []);

  /** 取消"即将关闭" */
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== 0) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
    }
  }, []);

  /** 延迟关闭（200ms） */
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = 0;
      setHoveredGroupKey(null);
      setHoveredId(null);
      onAnnotationHover?.(null);
    }, 200);
  }, [cancelClose, onAnnotationHover]);

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (closeTimerRef.current !== 0) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = 0;
      }
    },
    [],
  );

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
    const map = new Map<
      string,
      { left: number; top: number; width: number; height: number; startLeft: number }
    >();

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
      /*
       * ⚠️ **"起点"**（第一行的左边界）—— 用来**排序**。
       *
       * -> 并集的 `left` 是**所有行**的最左边 ❌
       * -> 一条跨 3 行的高亮 -> 并集 left 是**第 3 行**的位置 ❌
       * -> 分组排序按它 -> **列表顺序反了** ❌
       * -> `startLeft` = **第一行**的左边界 -> **文档顺序**
       */
      let startLeft = Infinity;
      let startTop = Infinity;
      for (const r of rects) {
        if (r.top < startTop || (r.top === startTop && r.left < startLeft)) {
          startLeft = r.left;
          startTop = r.top;
        }
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.left + r.width);
        bottom = Math.max(bottom, r.top + r.height);
      }
      map.set(annotation.id, {
        left,
        top,
        width: right - left,
        height: bottom - top,
        startLeft,
      });
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

        /*
         * ⚠️ **选择列表往哪边开**（实测踩过的坑）。
         *
         * ### 问题
         *
         * -> 列表默认 `left: 26px`（图标的**右边**）❌
         * -> 便签在页面**偏右**时 -> 列表跑到**屏幕外面** ❌
         *    -> 实测：列表的 x=1544，视口只有 1442 -> **点在屏幕外** ❌
         *    -> 用户点不到任何一项 -> "点击每一项没反应"
         *
         * ### 修法
         *
         * -> 右边放不下（超出页宽）-> **往左边开**
         */
        const pickerWidth = 200;
        const flipLeft = pos.left + 26 + pickerWidth > viewport.width;

        return (
          <span
            key={group.key}
            className="scpdf-sticky-note"
            data-group={isGroup ? 'true' : 'false'}
            style={{ left: pos.left, top: pos.top }}
          >
            {/*
             * ⚠️ **"桥接区"**（用户反馈："鼠标一移开批注按钮 批注内容区域就消失了"）。
             *
             * -> 内容框在 `left: 26px` -> 图标右边**有 4px 空隙** ❌
             * -> 鼠标从图标移向内容框 -> **穿过**那 4px ❌
             *    -> 图标触发 `mouseleave` -> 内容框消失 ❌
             * -> 这个**透明**元素**盖住**那段空隙
             *    -> 鼠标**不会**经过空隙 -> 不会触发 `mouseleave`
             */}
            <span
              className="scpdf-sticky-note__bridge"
              onMouseEnter={cancelClose}
              aria-hidden="true"
            />
            <button
              type="button"
              className="scpdf-sticky-note__icon"
              /*
               * ⚠️ **带上批注 id**（给"便利贴详情面板"当锚点用）。
               * -> 面板要**贴在便签旁边** -> 要找到便签的位置
               */
              data-note-id={first.id}
              /*
               * ⚠️⚠️ **带上【整组】的 id**（实测踩到的坑，用户反馈：
               * "如果同一位置两个批注 那么第一个批注点击之后展示位置正常
               *  第二个批注详情点击之后还是会出现在pdf的首页位置"）。
               *
               * -> 合并组**只渲染 1 个图标**
               * -> DOM 上只有 \`data-note-id={first.id}\` ❌
               * -> 选**第二条**批注 -> 按第二条的 id **找不到元素** ❌
               * -> -> 锚点**保持上一次的旧值** ❌
               * -> -> 面板停在上次的位置（第一次是**首页**）❌
               *
               * -> 现在把**整组的 id** 都写上
               * -> 面板找"包含这个 id 的图标"  -> 任何一条都能定位
               */
              data-note-ids={group.annotations.map((a) => a.id).join(',')}
              ref={(element) => {
                /*
                 * ⚠️ **存下图标元素** → hover 时量它的视口位置
                 * → 用来算内容框的 fixed 坐标
                 */
                if (element) {
                  iconRefs.current.set(group.key, element);
                } else {
                  iconRefs.current.delete(group.key);
                }
              }}
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
                // ⚠️ **取消"即将关闭"**（延迟关闭的另一半）
                cancelClose();
                setHoveredGroupKey(group.key);
                setHoveredId(first.id);
                if (!isGroup) {
                  onAnnotationHover?.(firstRecord);
                }
                /*
                 * ⚠️ **算内容框的位置**（视口坐标）。
                 *
                 * → 内容框现在是 `position: fixed` ✅ -> 不再被页面裁掉 ✅
                 * -> 坐标每次 hover 都重算 ✅ -> 容器滚动了也不会错 ✅
                 */
                const icon = iconRefs.current.get(group.key);
                if (icon) {
                  updateContentPos(icon, null);
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
                 * → 修法：判断"鼠标是不是移到相关的兄弟节点上" → 是就不清
                 * → （用 `relatedTarget` 判断，比 `contains` 更准）
                 */
                const related = event.relatedTarget as Node | null;
                if (related && event.currentTarget.parentElement?.contains(related)) {
                  return;
                }
                // ⚠️ **延迟 200ms 再关**（而不是立刻关）
                // -> 鼠标从图标移向内容框时，穿过空隙也不会消失
                scheduleClose();
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
              → 现在用 `<RichTextPreview>` → **排版好的富文本**
            */}
            {!isGroup ? (
              <span
                className="scpdf-sticky-note__content"
                data-visible={hoveredId === first.id ? 'true' : 'false'}
                role="note"
                /*
                 * ⚠️ **位置由 JS 算**（视口坐标）。
                 *
                 * → 内容框是 `position: fixed` → 不受任何祖先的 overflow 影响
                 * → 便签在页边角时**不会被页面裁掉**
                 *
                 * → 实测（修复前）：页右边超出 128px、页右下角超出 128px 宽 + 71px 高
                 */
                style={contentPos ? { left: contentPos.left, top: contentPos.top } : undefined}
                /*
                 * ⚠️ **鼠标进入内容框 → 保持 hover 状态**（用户反馈：
                 * "移动鼠标到批注的文字上面 框就消失了"）。
                 *
                 * → 鼠标从图标移过来时，图标已经触发 mouseleave
                 * → 这里再把它设回来 → **框不会消失**
                 * → 用户能点里面的"编辑 / 展开"按钮
                 */
                onMouseEnter={() => {
                  // ⚠️ **取消"即将关闭"** -> 鼠标进来了，内容框**不会消失**
                  cancelClose();
                  setHoveredGroupKey(group.key);
                  setHoveredId(first.id);
                }}
                onMouseLeave={(event) => {
                  const related = event.relatedTarget as Node | null;
                  if (related && event.currentTarget.parentElement?.contains(related)) {
                    return;
                  }
                  // ⚠️ **延迟 200ms 再关**
                  scheduleClose();
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
                           *   要出现在视野里啊 就点的旁边"
                           * -> 宿主用它的 `getBoundingClientRect()` 当锚点
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
                /* ⚠️ **往左边开**（右边放不下时）*/
                data-flip={flipLeft ? 'true' : 'false'}
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
                        /*
                         * ⚠️⚠️ **点某一项 -> 打开"那一条"的详情**（用户反馈：
                         * "点击每一项没反应 应该打开对应项的便签详情 然后可以编辑"）。
                         *
                         * -> 之前只调 \`onAnnotationClick\`（宿主的通知回调）❌
                         *    -> demo 里只是 \`setHint(...)\` -> **看不到任何变化** ❌
                         *    -> 用户以为"点了没反应" ❌
                         *
                         * -> 现在：**调 \`onAnnotationExpand\`**（包会打开详情面板）
                         * -> **同时**通知宿主
                         */
                        onAnnotationExpand?.(record);
                        onAnnotationClick?.(record);
                        // 关闭选择列表 -> 别挡住刚打开的详情
                        setHoveredGroupKey(null);
                        setHoveredId(null);
                      }}
                    >
                      {/*
                       * ⚠️⚠️ **渲染富文本**（用户反馈：
                       * "第一展示有问题 没有渲染出html"）。
                       *
                       * -> 之前是 \`{record.content.slice(0, 60)}\` ❌
                       *    -> React **转义** HTML -> 用户看到字面量 \`<p>第一条</p>\` ❌
                       *    -> 实测：\`itemHTML: "&lt;p&gt;第一条&lt;/p&gt;"\` ❌
                       *
                       * -> 现在用 \`<RichTextPreview>\`
                       *    -> **渲染成排版好的富文本**
                       *    -> 而且**自带消毒**（白名单）
                       *    -> 和单条便签的浮层**行为一致**
                       */}
                      <RichTextPreview
                        className="scpdf-sticky-note__picker-text"
                        html={record.content}
                      />
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
