/**
 * AnnotationPanel —— **便利贴面板**（批注的编辑 / 查看 UI）。
 *
 * ## 用户需求
 *
 * > "点击批注的时候展开的是一个便利贴一样的ui 在页面中间偏右的区域
 * >  目前都没展示完整 在最右边被挡住了 便利贴 稍微大一点的那种"
 *
 * ## 位置怎么算（实测踩过的坑）
 *
 * ⚠️ **不能贴在"便签图标"的旁边** —— 那是在页面的最右边 → **会被容器裁掉** ❌
 * → 用户原话："目前都没展示完整 在最右边被挡住了"
 *
 * ### 本实现：**页面中间偏右**
 *
 * ```
 * 容器宽度 W
 * 面板宽度 panelW
 * 面板左边 = W * 0.5 + (W * 0.5 - panelW) * 0.5   ← 中间偏右
 * ```
 *
 * → 落在**可视区中间偏右** → 完整可见 ✅
 * → 而且是"贴着页面"的（不是贴着屏幕边缘）
 *
 * ## 包的边界
 *
 * → 包只给**UI + 事件**
 * → 存什么、怎么存 → 宿主（`onChange` / `onSubmit`）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import { richTextToPlain, sanitizeRichText } from '../core/editor/rich-text';
import { computeDialogPosition } from '../core/selection/dialog-position';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { RichTextEditor } from './RichTextEditor';

/** 面板的默认宽度（px） */
/**
 * **批注详情面板的宽度**（px）。
 *
 * ⚠️ **为什么是 360**（用户需求）：
 * > "希望和编辑页面保持一致 宽度也一直吧
 * >  这样转成编辑页面的时候 工具栏不会分成两行展示"
 *
 * -> 实测：面板 320px 时，13 个按钮的工具栏**占 2 行** ❌
 * -> -> 宽度不够 ✅ -> 提到 360px ✅
 */
export const ANNOTATION_PANEL_WIDTH = 360;

/** AnnotationPanel 参数 */
export interface AnnotationPanelProps {
  /** 当前批注（`null` = 关闭） */
  annotation: AnnotationRecord | null;
  /** 容器尺寸（用来算位置） */
  container: { width: number; height: number };
  /**
   * **便签的视口矩形**（用来把面板贴在便签旁边）。
   *
   * ⚠️ **之前面板固定在"页面中间偏右"** ❌
   *    -> 便签在 \`x=571\`，面板在 \`x=918\` -> **离得很远** ❌
   *    -> 用户反馈："打开详细按钮目前是失效的 需要点击能打开一个稍微大一点的便利贴的样式" ✅
   *
   * -> 传了 -> **贴在便签旁边**（优先放右边，放不下就翻到左边）✅
   */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * **滚动容器的 ref**（用来把"视口坐标"换成"容器坐标"）。
   *
   * ⚠️ **必须传** ❌
   * -> 面板是 `position: absolute` -> 相对 `.scpdf-container` ✅
   * -> 但 `computeDialogPosition` 返回的是**视口坐标** ✅
   * -> 不减掉容器的偏移 -> 面板**整体偏移** ❌
   *    （实测：偏了 124px -> "出现在 PDF 的最上方"❌）
   */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** 批注内容变化（HTML + 纯文本） */
  onChange?: (id: string, html: string, plain: string) => void;
  /** 保存 */
  onSubmit?: (id: string, html: string, plain: string) => void;
  /** 删除 */
  onDelete?: (id: string) => void;
  /** 关闭 */
  onClose?: () => void;
  /** 富文本工具栏（宿主可配；不传 → 默认的） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板（**浅色**，当"高亮底色"用） */
  palette?: RichTextPalette;
  /**
   * **"文字颜色"色板**（**深色**）。
   *
   * ⚠️ **和 `palette` 分开**（用户反馈：
   * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
   */
  textPalette?: RichTextPalette;
  /** 只读模式（只看不改） */
  readOnly?: boolean;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
  /**
   * **富文本编辑器**（宿主可换，比如 TipTapEditor）。
   *
   * -> 不传 -> 用包内置的轻量编辑器
   */
  editor?: React.ComponentType<{
    value?: string;
    onChange?: (html: string, plain: string) => void;
    toolbar?: RichTextToolbarItem[];
    palette?: RichTextPalette;
    /** **文字颜色**色板（**深色**） */
    textPalette?: RichTextPalette;
    placeholder?: string;
    icons?: Partial<Record<IconName, ReactNode>>;
    locale?: Locale;
    locales?: LocaleTable;
    messages?: LocaleMessagesMap;
  }>;
}

/**
 * 便利贴面板。
 *
 * @param props 参数
 */
export function AnnotationPanel(props: AnnotationPanelProps) {
  const {
    annotation,
    container,
    anchorRect,
    containerRef,
    onChange,
    onSubmit,
    onDelete,
    onClose,
    toolbar,
    palette,
    textPalette,
    readOnly = false,
    icons,
    locale = 'zh',
    locales,
    messages,
    editor,
  } = props;

  /**
   * 文案解析。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 之前面板的 title 是**硬编码中文** → 现在全走文案表 ✅
   */
  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages, undefined, locales),
    [locale, messages, locales],
  );

  /** 面板 ref（用来点外面关闭） */
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** 当前批注的 HTML（本地草稿） */
  const [draft, setDraft] = useState('');

  // 切换批注 → 重置草稿
  useEffect(() => {
    if (!annotation) {
      setDraft('');
      return;
    }
    // ⚠️ **批注内容可能是纯文本**（老数据）→ 包成段落
    const content = annotation.content ?? '';
    setDraft(content.includes('<') ? content : `<p>${content}</p>`);
  }, [annotation]);

  // 点外面 → 关闭
  useEffect(() => {
    if (!annotation) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const el = panelRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) {
        return;
      }
      onClose?.();
    };
    // ⚠️ 用 `pointerdown`（比 mousedown 更早，能避免和按钮点击打架）
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [annotation, onClose]);

  /** 内容变化 */
  const handleChange = useCallback(
    (html: string, plain: string) => {
      setDraft(html);
      if (annotation) {
        onChange?.(annotation.id, html, plain);
      }
    },
    [annotation, onChange],
  );

  /*
   * ⚠️ **是不是在"编辑模式"**（用户需求）。
   *
   * ### 用户反馈
   *
   * > "便签详情打开的时候也是要有按钮可以选编辑的 选择编辑的时候便签详情就消失隐藏"
   *
   * ### 现在的做法（用户选的 **B 方案**："先试试B的效果"）
   *
   * -> **默认只读**（显示排版好的富文本）✅
   * -> 点"编辑" -> **就地变成编辑器**（**不弹窗**）✅
   * -> 点"完成" -> 回到只读 ✅
   *
   * -> 之前是**直接进编辑器**（没这一步）❌
   *   -> 打开详情就看到一个工具栏 -> 不像"详情" ❌
   */
  const [editing, setEditing] = useState(false);

  // 切换批注 -> 退出编辑模式
  useEffect(() => {
    setEditing(false);
  }, []);

  /** 提交（**顺带清洗 HTML**，防 XSS） */
  const handleSubmit = useCallback(
    (html: string, plain: string) => {
      if (!annotation) {
        return;
      }
      const safe = sanitizeRichText(html);
      onSubmit?.(annotation.id, safe, plain);
      setEditing(false);
    },
    [annotation, onSubmit],
  );

  /*
   * ⚠️ **位置：贴着便签**（用户需求：
   * "点击批注详情 批注详情目前是出现在pdf的最上方 应该定位在批注按钮附近的
   *  跟编辑批注的位置应该是差不多的"）。
   *
   * ### ⚠️⚠️ **坐标系必须对齐**（实测踩到的坑）
   *
   * -> `computeDialogPosition` 返回的是**视口坐标** ✅
   * -> 但面板是 `position: absolute` -> **父容器是 `.scpdf-container`** ❌
   * -> 容器的 `offsetParent` 在视口里是 `(x=8, y=124)` ❌
   *    -> 绝对定位会**再加一遍这个偏移** ❌
   *    -> 面板**整体下移 124px** -> "出现在 PDF 的最上方" ❌
   *
   * ### 实测（修复前）
   *
   * ```
   * panel.style.left = "539.227px"    ← 视口坐标
   * offsetParent = .scpdf-container    ← 容器在视口里 x=8, y=124
   * → 面板实际落在 y = 399 + 124 = 523  ← 偏了 124px ❌
   * ```
   *
   * ### 修法
   *
   * -> **减去容器的偏移** ✅（视口坐标 -> 容器坐标）
   * -> 和"编辑批注"（`position: fixed`）**定位逻辑一致** ✅
   */
  /*
   * ⚠️⚠️ **滚动容器在视口里的偏移**（视口坐标 -> 容器坐标）。
   *
   * -> 面板是 `position: absolute` -> 相对 `.scpdf-container` ✅
   * -> 但 `computeDialogPosition` 返回的是**视口坐标** ✅
   * -> **必须减去这个偏移** ✅
   *
   * -> ⚠️ **必须用 state + useEffect**（不能在 useMemo 里现量）❌
   *    -> useMemo 在**渲染期间**跑 -> DOM 还没更新 -> 量到**旧值** ❌
   *    -> 实测：`top = 124 - 124 = 0` -> 面板贴到容器顶部 ❌
   */
  const [containerOffset, setContainerOffset] = useState<{
    left: number;
    top: number;
    /*
     * ⚠️⚠️ **容器的滚动量**（用户反馈：
     * "不管在哪个页面哪个地方点击批注按钮 批注详情都会出现在pdf首页的位置"✅）。
     *
     * -> 面板是 `position: absolute` -> 相对 **.scpdf-container 的内容原点** ✅
     * -> 而锚点是 `getBoundingClientRect()` -> **视口坐标** ✅
     * -> 换算：`内容坐标 = 视口坐标 - 容器视口原点 + scrollTop` ✅
     * -> ⚠️ **只减视口偏移、不加 scrollTop** ❌ -> 差了整个滚动量 ❌
     *    -> 实测（第 4 页，scrollTop=7000）：面板 y = **-6806** ❌
     */
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainerOffset({ left: r.left, top: r.top, scrollTop: el.scrollTop });
    };
    measure();
    const raf = requestAnimationFrame(measure);

    /*
     * ⚠️ **滚动时要重新量**。
     *
     * -> 容器滚动 -> 内容在动 -> 锚点（视口坐标）变了 ❌
     *    -> 但面板是**内容坐标** -> **不用动** ✅
     *    -> 但**scrollTop 变了** -> 换算要跟着变 ✅
     * -> 不监听滚动 -> 用户滚一下 -> 面板**飘了** ❌
     */
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', measure);
    };
  }, [containerRef]);

  const position = useMemo(() => {
    if (!anchorRect) {
      return {
        left: Math.max(
          8,
          container.width * 0.5 + (container.width * 0.5 - ANNOTATION_PANEL_WIDTH) * 0.5,
        ),
        top: Math.max(8, container.height * 0.18),
      };
    }

    /*
     * ⚠️⚠️ **视口尺寸必须是"窗口"的**，不是"滚动容器"的** ❌
     *
     * -> `computeDialogPosition` 拿 `viewport` 来判断"放不放得下" ✅
     * -> 传**滚动容器**的尺寸（1442 × 608）❌
     *    -> 容器比窗口矮 -> "下面放不下" -> 面板被**推到上面** ❌
     *    -> 实测：`top = 124` -> 面板贴在**容器顶部** ❌
     *    -> "出现在 PDF 的最上方" ✅
     * -> 传**窗口**的尺寸（1442 × 732）✅ -> 判断正确 ✅
     *
     * -> ⚠️ 容器尺寸只用来做"没锚点时的兜底位置" ✅
     */
    const viewport = {
      width: typeof window === 'undefined' ? container.width : window.innerWidth,
      height: typeof window === 'undefined' ? container.height : window.innerHeight,
    };
    /*
     * ⚠️ **`gap: 30`**（默认是 8）——
     *
     * -> 便签图标只有 **22px** 宽 ✅
     * -> gap=8 -> 面板**盖住便签**（图标被挡住，看不到"这是哪条批注"）❌
     * -> gap=30 -> 面板在便签**右边 30px** -> 两个都看得见 ✅
     */
    const dialog = computeDialogPosition({
      anchor: anchorRect,
      /*
       * ⚠️ **高度要给"小一点的值"**（实测踩到的坑）。
       *
       * -> 面板的**真实高度**是 `min(460px, 70%)`，不是固定的 ❌
       * -> 之前写死 **320** -> 算"下面放不下" -> 面板被放到**上面** ❌
       *    -> 实测：`anchor.bottom(391) + 30 + 320 = 741 > 732 - 12` ❌
       *    -> -> `top = anchor.top - 30 - 320 = 16` -> **贴在 PDF 最上方** ❌
       * -> 用 **200**（比"锚点下面能放下的高度"小）-> **正常贴在下面** ✅
       */
      size: { width: ANNOTATION_PANEL_WIDTH, height: 200 },
      viewport,
      gap: 30,
    });

    /*
     * ⚠️⚠️ **视口坐标 -> 容器坐标**（绝对定位的坐标系）✅
     *
     * -> 锚点是 `getBoundingClientRect()` -> **视口坐标** ✅
     * -> 面板是 `position: absolute` -> **相对 `.scpdf-container`** ✅
     * -> **必须减去容器的视口偏移** ✅
     *
     * ⚠️ **容器偏移要用 state**（不能在 useMemo 里现量）❌
     * -> useMemo 在**渲染期间**跑 -> 那时 DOM 还没更新 ❌
     * -> 量到的是**旧值**（甚至 0）❌
     * -> 实测：top 算成 `124 - 124 = 0` -> 面板贴到容器顶部 ❌
     * -> "出现在 PDF 的最上方" ✅
     */
    const offsetX = containerOffset?.left ?? 0;
    const offsetY = containerOffset?.top ?? 0;
    /*
     * ⚠️⚠️ **必须加上 `scrollTop`**（实测踩到的坑）。
     *
     * -> 视口坐标 -> 内容坐标：`y - 容器视口top + scrollTop` ✅
     * -> 之前**只减了视口偏移** ❌
     *    -> 容器滚到第 4 页（scrollTop=7000）-> 差 7000px ❌
     *    -> 实测：便签在 y=140，面板在 y=**-6806** ❌
     *    -> "批注详情都会出现在pdf首页的位置" ✅
     */
    const scrollTop = containerOffset?.scrollTop ?? 0;

    return {
      left: Math.max(0, dialog.left - offsetX),
      top: Math.max(0, dialog.top - offsetY + scrollTop),
    };
  }, [anchorRect, container.width, container.height, containerOffset]);

  const left = position.left;
  const top = position.top;

  if (!annotation) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className="scpdf-annotation-panel"
      /*
       * ⚠️ **给容器的点击委托一个"我是浮层"的标记**。
       * -> 容器上挂了高亮的点击委托（按鼠标坐标命中）✅
       * -> 浮层里的点击**不能**触发它（否则下面的高亮会被误激活）✅
       */
      data-scpdf-floating="true"
      style={{ left, top, width: ANNOTATION_PANEL_WIDTH }}
      role="dialog"
      aria-label={t('annotation.title')}
    >
      {/* 标题栏 */}
      <div className="scpdf-annotation-panel__head">
        <span className="scpdf-annotation-panel__title">
          <Icon name="stickyNote" size={15} overrides={icons} />
          {t('annotation.title')}
        </span>
        <span className="scpdf-annotation-panel__actions">
          {/*
           * ⚠️ **"编辑"按钮**（用户需求：
           * "便签详情打开的时候也是要有按钮可以选编辑的"）。
           *
           * -> **默认只读**（详情）✅
           * -> 点"编辑" -> **就地变成编辑器**（B 方案：不弹窗）✅
           * -> 编辑中 -> 按钮变成"完成" ✅
           */}
          {!readOnly ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={editing ? t('annotation.done') : t('annotation.edit')}
              aria-label={editing ? t('annotation.done') : t('annotation.edit')}
              onClick={() => setEditing((v) => !v)}
            >
              <Icon name={editing ? 'check' : 'edit'} size={14} overrides={icons} />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={t('annotation.delete')}
              aria-label={t('annotation.delete')}
              onClick={() => onDelete(annotation.id)}
            >
              <Icon name="trash" size={14} overrides={icons} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={t('annotation.close')}
              aria-label={t('annotation.close')}
              onClick={onClose}
            >
              <Icon name="close" size={14} overrides={icons} />
            </button>
          ) : null}
        </span>
      </div>

      {/* 内容（只读 → 显示 HTML；可编辑 → 富文本编辑器） */}
      <div className="scpdf-annotation-panel__body">
        {readOnly || !editing ? (
          <ReadOnlyContent html={draft} />
        ) : (
          (() => {
            const EditorComponent = editor ?? RichTextEditor;
            return (
              <EditorComponent
                value={draft}
                toolbar={toolbar}
                palette={palette}
                textPalette={textPalette}
                locale={locale}
                locales={locales}
                messages={messages}
                onChange={handleChange}
                onSubmit={onSubmit ? handleSubmit : undefined}
                icons={icons}
              />
            );
          })()
        )}
      </div>

      {/* 底部信息 */}
      {annotation.createdAt ? (
        <div className="scpdf-annotation-panel__foot">
          {new Date(annotation.createdAt).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}

/**
 * **只读内容**（渲染富文本 HTML）。
 *
 * ⚠️ **这里用 `dangerouslySetInnerHTML`**（内容是富文本 HTML）。
 *
 * → 安全责任在**调用方**：宿主传进来的内容应当已经过
 *   `sanitizeRichText` 处理（包也导出了这个函数）
 * → 或者宿主用 `readOnly` 时自己保证数据可信
 *
 * biome 的 `noDangerouslySetInnerHtml` 在这里是**误报**
 * → 富文本内容**必须**用 innerHTML 渲染（否则标签会显示成文本）
 *
 * @param props 参数
 */
function ReadOnlyContent({ html }: { html: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: 富文本内容必须用 innerHTML 渲染
    <div className="scpdf-annotation-panel__content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/**
 * **取批注的纯文本**（列表用）。
 *
 * @param annotation 批注
 * @returns 纯文本
 */
export function annotationPlainText(annotation: AnnotationRecord): string {
  return richTextToPlain(annotation.content ?? '');
}
