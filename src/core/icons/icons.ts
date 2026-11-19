/**
 * icons —— 包的**内置图标集**（零依赖）。
 *
 * ## 为什么自己画（不引图标库）
 *
 * 用户反馈："按钮不好看 上传下载 添加高亮这些 都不好看 再找一些图标插件"
 *
 * → 调研过 `lucide-react`（0 运行时依赖、可 tree-shake、MIT）
 * → 但它**解包 38MB**，而且每个图标都是 React 组件
 * → 包的体积预算是 **25 kB**（`.size-limit.json`）→ 引进来直接超预算 ❌
 * → 而且图标库会变成**硬依赖** → 宿主想换风格就得 fork
 *
 * ## 折中方案（本实现）
 *
 * **包内自研一套图标**（现代风格）+ **宿主可覆盖**。
 *
 * ### 设计规范（和 Lucide / Feather 同一套视觉语言）
 *
 * - 画布：`viewBox="0 0 24 24"`（主流图标库的标准尺寸 → 缩放不失真）
 * - 描边：`strokeWidth={1.75}` + `strokeLinecap="round"` + `strokeLinejoin="round"`
 * - 颜色：`currentColor` → 跟随主题（不用写死颜色）
 * - 每个图标都有 `<title>` → 无障碍 + 调试友好
 *
 * ### 为什么从 16×16 换成 24×24
 *
 * → 16×16 下"导出 JSON"和"导出 PDF"这类图标**没法区分** → 显得粗糙
 * → 24×24 是所有主流图标库的标准 → 视觉更精致
 * → 组件用 `size` 缩放（默认 18px，视觉重量和 16px 接近）
 *
 * ## 宿主怎么覆盖
 *
 * ```tsx
 * <PdfViewer icons={{ upload: <MyUploadIcon />, download: <MyDownloadIcon /> }} />
 * ```
 *
 * → 包用宿主的 → 风格统一 → 宿主想用 `lucide-react` 随时可以换 ✅
 */

/** 图标名（内置的全部图标） */
export type IconName =
  // —— 导航 ——
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronUp'
  | 'chevronDown'
  | 'arrowLeft'
  | 'arrowRight'
  // —— 缩放 ——
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'fitPage'
  | 'rotate'
  // —— 视图 ——
  | 'search'
  | 'thumbnails'
  | 'outline'
  | 'print'
  // —— 文件 ——
  | 'upload'
  | 'download'
  | 'file'
  | 'fileText'
  | 'exportJson'
  | 'exportPdf'
  // —— 选区操作 ——
  | 'highlight'
  | 'highlightColor'
  | 'comment'
  | 'copy'
  | 'trash'
  | 'more'
  // —— 批注 ——
  | 'note'
  | 'stickyNote'
  | 'translate'
  | 'ask'
  | 'explain'
  // —— 通用 ——
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'edit'
  | 'link'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'textColor'
  | 'list'
  | 'listOrdered'
  | 'menu'
  | 'settings';

/** 圆 */
export interface IconCircle {
  cx: number;
  cy: number;
  r: number;
}

/** 矩形 */
export interface IconRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

/** 直线 */
export interface IconLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 折线（`points`） */
export interface IconPolyline {
  points: string;
}

/** 单个图标的绘制数据 */
export interface IconShape {
  /** 描边路径（`d`） */
  paths?: readonly string[];
  /** 填充路径（`d`） */
  fills?: readonly string[];
  /** 圆 */
  circles?: readonly IconCircle[];
  /** 矩形 */
  rects?: readonly IconRect[];
  /** 直线 */
  lines?: readonly IconLine[];
  /** 折线 */
  polylines?: readonly IconPolyline[];
}

/**
 * 内置图标的几何数据。
 *
 * ⚠️ **坐标系统一 24×24**，描边 `currentColor`，`strokeWidth` 默认 1.75。
 *
 * @param name 图标名
 * @returns 几何数据（没有则 `null`）
 */
export function getIconShape(name: IconName): IconShape | null {
  switch (name) {
    // ———————————————— 导航 ————————————————
    case 'chevronLeft':
      return { polylines: [{ points: '15 18 9 12 15 6' }] };
    case 'chevronRight':
      return { polylines: [{ points: '9 18 15 12 9 6' }] };
    case 'chevronUp':
      return { polylines: [{ points: '6 15 12 9 18 15' }] };
    case 'chevronDown':
      return { polylines: [{ points: '6 9 12 15 18 9' }] };
    case 'arrowLeft':
      return {
        paths: ['M19 12H5'],
        polylines: [{ points: '12 19 5 12 12 5' }],
      };
    case 'arrowRight':
      return {
        paths: ['M5 12h14'],
        polylines: [{ points: '12 5 19 12 12 19' }],
      };

    // ———————————————— 缩放 ————————————————
    case 'zoomIn':
      return {
        circles: [{ cx: 11, cy: 11, r: 7 }],
        paths: ['M20 20l-3.6-3.6'],
        lines: [
          { x1: 11, y1: 8, x2: 11, y2: 14 },
          { x1: 8, y1: 11, x2: 14, y2: 11 },
        ],
      };
    case 'zoomOut':
      return {
        circles: [{ cx: 11, cy: 11, r: 7 }],
        paths: ['M20 20l-3.6-3.6'],
        lines: [{ x1: 8, y1: 11, x2: 14, y2: 11 }],
      };
    case 'fitWidth':
      // 左右两竖线 + 中间双向箭头
      return {
        paths: ['M4 4v16', 'M20 4v16'],
        polylines: [{ points: '8 9 5 12 8 15' }, { points: '16 9 19 12 16 15' }],
        lines: [{ x1: 5, y1: 12, x2: 19, y2: 12 }],
      };
    case 'fitPage':
      // 纸张 + 三行文字
      return {
        rects: [{ x: 6, y: 3, width: 12, height: 18, rx: 2 }],
        paths: ['M9 8h6', 'M9 12h6', 'M9 16h3'],
      };
    case 'rotate':
      return {
        paths: ['M20.5 12a8.5 8.5 0 1 1-2.8-6.3'],
        polylines: [{ points: '21 3 21 9 15 9' }],
      };

    // ———————————————— 视图 ————————————————
    case 'search':
      return {
        circles: [{ cx: 11, cy: 11, r: 7 }],
        paths: ['M20 20l-3.6-3.6'],
      };
    case 'thumbnails':
      // 左侧缩略图栏 + 右侧两块内容
      return {
        rects: [
          { x: 3, y: 3, width: 8, height: 18, rx: 1.5 },
          { x: 13, y: 3, width: 8, height: 8, rx: 1.5 },
          { x: 13, y: 13, width: 8, height: 8, rx: 1.5 },
        ],
      };
    case 'outline':
      // 目录：三条横线 + 三个圆点
      return {
        paths: ['M9 6h11', 'M9 12h11', 'M9 18h11'],
        circles: [
          { cx: 4.5, cy: 6, r: 1.2 },
          { cx: 4.5, cy: 12, r: 1.2 },
          { cx: 4.5, cy: 18, r: 1.2 },
        ],
      };
    case 'print':
      return {
        paths: ['M6 9V3h12v6', 'M6 18H4v-6h16v6h-2'],
        rects: [{ x: 6, y: 14, width: 12, height: 7, rx: 1 }],
      };

    // ———————————————— 文件 ————————————————
    /*
     * ⚠️ **上传 / 下载**：箭头**在云里**（不是骑在云上）。
     *
     * 用户反馈："上传下载的图标 箭头放的位置也不对 超出来了"
     *
     * ### 之前的画法（有问题）
     * ```
     * 箭头: M12 20v-7  → 从 y=20 到 y=13
     * 云:   顶边在 y≈9.6
     * ```
     * → 箭头**戳出云顶** → 看起来"箭头跑到云外面了" ❌
     *
     * ### 现在的画法
     * - 云：顶边 y=9，底边 y=19
     * - 箭头：在 **y=16.5 → y=11.5**（完全在云里）
     * - 箭头宽 3.5，云的左边界在箭头处约 x=7 → 箭头不会碰到云边 ✅
     */
    case 'upload':
      return {
        paths: [
          // 箭头（向上，在云内部）
          'M12 16.5v-5',
          'M9.5 14 12 11.5 14.5 14',
          // 云（轮廓，开口在底部）
          'M7 19a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.2 12a3.5 3.5 0 0 1-.7 7H17',
        ],
      };
    case 'download':
      return {
        paths: [
          // 箭头（向下，在云内部）
          'M12 11.5v5',
          'M9.5 14 12 16.5 14.5 14',
          // 云（轮廓，开口在底部）
          'M7 19a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.2 12a3.5 3.5 0 0 1-.7 7H17',
        ],
      };
    case 'file':
      return {
        paths: ['M14 3v5h5', 'M19 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z'],
      };
    case 'fileText':
      return {
        paths: ['M14 3v5h5', 'M19 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z'],
        lines: [
          { x1: 9, y1: 12, x2: 15, y2: 12 },
          { x1: 9, y1: 16, x2: 13, y2: 16 },
        ],
      };
    case 'exportJson':
      // 大括号（JSON）
      return {
        paths: [
          'M9 4c-2 0-3 1-3 3v2c0 1.5-.7 2.5-2 3 1.3.5 2 1.5 2 3v2c0 2 1 3 3 3',
          'M15 4c2 0 3 1 3 3v2c0 1.5.7 2.5 2 3-1.3.5-2 1.5-2 3v2c0 2-1 3-3 3',
        ],
      };
    case 'exportPdf':
      // 文件 + 向下箭头
      return {
        paths: [
          'M13 3v5h5',
          'M19 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6l5 5v3',
          'M12 12v6',
          'M9.5 15.5 12 18l2.5-2.5',
        ],
      };

    // ———————————————— 选区操作 ————————————————
    case 'highlight':
      // 荧光笔：笔身斜置 + 笔尖 + 底线
      return {
        paths: ['M13.5 4.5 19 10l-8 8H6.5v-4.5l7-9Z', 'M4 21h16'],
        fills: ['M13.5 4.5 19 10l-2 2-5.5-5.5 2-2Z'],
      };
    case 'highlightColor':
      // 高亮笔 + 底部色条
      return {
        paths: ['M14 4l6 6-8 8H6v-6l8-8Z'],
        rects: [{ x: 4, y: 20, width: 16, height: 2, rx: 1 }],
      };
    case 'comment':
      // 对话气泡
      return {
        paths: [
          'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.9-.8L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.7 8.4 8.4 0 0 1 8.5-8.4h.5a8.4 8.4 0 0 1 8 7.6Z',
        ],
      };
    case 'copy':
      /*
       * ⚠️ **两张重叠的纸**（用户反馈："图标复制和翻译这两个需要重画 目前挤压在一起了"）。
       *
       * ### 之前的画法（有问题）
       * ```
       * rect(9, 9, 11, 11)   ← 后面的纸
       * rect(5, 15, 11, 6)   ← 前面的纸（只有 6 高 → 像个横条）
       * ```
       * → 两个矩形**一大一小** → 看起来**挤在一起**、不成比例 ❌
       *
       * ### 现在的画法（和 Lucide 的 `copy` 一致）
       * - 后面那张纸：8,8 → 20,20（12×12）
       * - 前面那张纸：4,4 → 16,16（12×12）
       * - 前面那张**只有上边和左边**是实线（后面被挡住的部分不画）
       * → 两张**同样大小**的纸，斜着错开 → 一眼能看出"复制" ✅
       */
      return {
        paths: [
          // 后面那张纸：完整的矩形
          'M8 8h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z',
          // 前面那张纸：只画"露出来"的上边和左边
          'M16 4H7a3 3 0 0 0-3 3v9',
        ],
      };
    case 'trash':
      return {
        paths: ['M4 6h16', 'M10 4h4', 'M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14'],
        lines: [
          { x1: 10, y1: 10, x2: 10, y2: 17 },
          { x1: 14, y1: 10, x2: 14, y2: 17 },
        ],
      };
    case 'more':
      // 三个点（竖排）
      return {
        circles: [
          { cx: 12, cy: 5, r: 1.6 },
          { cx: 12, cy: 12, r: 1.6 },
          { cx: 12, cy: 19, r: 1.6 },
        ],
      };

    // ———————————————— 批注 ————————————————
    case 'note':
      return {
        paths: [
          'M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l6-6V5a2 2 0 0 0-2-2Z',
          'M14 21v-5a2 2 0 0 1 2-2h5',
        ],
      };
    case 'stickyNote':
      // 便签（折角 + 横线）
      return {
        paths: [
          'M20 12V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l6-6Z',
          'M14 21v-5a2 2 0 0 1 2-2h5',
        ],
        lines: [
          { x1: 8, y1: 8, x2: 16, y2: 8 },
          { x1: 8, y1: 12, x2: 14, y2: 12 },
        ],
      };
    case 'translate':
      /*
       * ⚠️ **"文A"**（用户反馈："图标复制和翻译这两个需要重画 目前挤压在一起了"）。
       *
       * ### 之前的画法（有问题）
       * ```
       * "文" 占 x=3..11
       * "A"  占 x=8..16     ← 两部分在 x=8..11 **重叠** ❌
       * ```
       * → 两个字**挤在一起** → 看不清是"翻译" ❌
       *
       * ### 现在的画法
       * - "文"（左上）：x=2..11, y=3..13
       * - "A"（右下）：x=12..22, y=10..21
       * → 两部分**完全分开**（中间留 1px）→ 一眼能看出是"翻译" ✅
       */
      return {
        paths: [
          // —— 左上：文 ——
          'M2 5h9',
          'M6.5 5V3.2',
          'M3.6 5c.9 3 2.5 4.8 5 6.1',
          'M8.8 8.4 6.2 13',
          'M4.6 11h4',
          // —— 右下：A ——
          'M14 21l3.6-8 3.6 8',
          'M15.1 17.6h5',
        ],
      };
    case 'ask':
      // 对话气泡 + 问号
      return {
        paths: [
          'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.9-.8L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.7 8.4 8.4 0 0 1 8.5-8.4h.5a8.4 8.4 0 0 1 8 7.6Z',
          'M9.7 9.2a2.4 2.4 0 0 1 4.7.5c0 1.6-2.4 1.9-2.4 3.3',
        ],
        circles: [{ cx: 12, cy: 16, r: 0.9 }],
      };
    case 'explain':
      // 灯泡
      return {
        paths: [
          'M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.4.9 1 .9 1.6v.7h6v-.7c0-.6.3-1.2.9-1.6A6.5 6.5 0 0 0 12 2.5Z',
          'M9.5 18.5h5',
          'M10.5 21.5h3',
        ],
      };

    // ———————————————— 通用 ————————————————
    case 'plus':
      return {
        lines: [
          { x1: 12, y1: 5, x2: 12, y2: 19 },
          { x1: 5, y1: 12, x2: 19, y2: 12 },
        ],
      };
    case 'minus':
      return { lines: [{ x1: 5, y1: 12, x2: 19, y2: 12 }] };
    case 'close':
      return { paths: ['M18 6 6 18', 'M6 6l12 12'] };
    case 'check':
      return { polylines: [{ points: '20 6 9 17 4 12' }] };
    case 'edit':
      // 铅笔
      return {
        paths: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
      };
    case 'link':
      return {
        paths: [
          'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7',
          'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
        ],
      };
    case 'bold':
      return {
        paths: ['M7 5h5.5a3.5 3.5 0 0 1 0 7H7Z', 'M7 12h6.5a3.5 3.5 0 0 1 0 7H7Z'],
      };
    case 'italic':
      return { paths: ['M15 4h-5', 'M14 20H9', 'M14.5 4 9.5 20'] };
    case 'underline':
      return {
        paths: ['M6 4v7a6 6 0 0 0 12 0V4', 'M4 20h16'],
      };
    case 'textColor':
      // "A" + 下划线
      return {
        paths: ['M8 17 12 5l4 12', 'M9.5 13h5'],
        lines: [{ x1: 4, y1: 20, x2: 20, y2: 20 }],
      };
    case 'list':
      return {
        paths: ['M9 6h11', 'M9 12h11', 'M9 18h11'],
        circles: [
          { cx: 4.5, cy: 6, r: 1.2 },
          { cx: 4.5, cy: 12, r: 1.2 },
          { cx: 4.5, cy: 18, r: 1.2 },
        ],
      };
    case 'listOrdered':
      return {
        paths: ['M10 6h10', 'M10 12h10', 'M10 18h10'],
        polylines: [{ points: '4 5 5 4 5 8' }],
      };
    case 'menu':
      return { paths: ['M4 7h16', 'M4 12h16', 'M4 17h16'] };
    case 'settings':
      // 齿轮
      return {
        circles: [{ cx: 12, cy: 12, r: 3 }],
        paths: [
          'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
        ],
      };

    default:
      return null;
  }
}
