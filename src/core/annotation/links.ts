/**
 * 链接标注 —— 核心逻辑（纯函数）。
 *
 * PDF 的链接分两类：
 * - **外部链接**（URI）：http / mailto / tel 等
 * - **内部跳转**（GoTo）：跳到文档内某页某位置
 *
 * 为什么要单独放 core：
 * - 链接区域是**几何**（可点击的矩形），要参与命中测试与坐标换算
 * - 纯函数 → 可单测，不用起浏览器
 */

/** 链接注解（pdf.js Annotation 的最小形状） */
export interface LinkAnnotationLike {
  /** 注解类型（pdf.js 用 'Link'） */
  subtype?: string;
  /** 矩形（PDF 用户空间） */
  rect: number[];
  /** 链接目标 */
  url?: string;
  /** 内部跳转目标 */
  dest?: string | unknown[] | null;
  /** 是否为链接（判断用） */
  isLink?: boolean;
}

/** 归一化后的链接 */
export interface NormalizedLink {
  /** 链接 id（React key） */
  id: string;
  /** 矩形（归一化坐标，与缩放无关） */
  rect: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
  };
  /** 外部 URL（内部跳转为 null） */
  url: string | null;
  /** 内部跳转目标（外部链接为 null） */
  dest: string | unknown[] | null;
}

/** 允许的协议（防止 javascript: 之类的 XSS） */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'ftp:'];

/**
 * 判断 URL 是否安全（只允许常见协议）。
 *
 * 为什么：`javascript:` / `data:` 协议能执行脚本 → PDF 是不可信输入，
 * 渲染成可点击链接前必须过滤。
 *
 * @param url URL
 * @returns 是否安全
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // 相对链接（无协议）→ 允许（由宿主决定怎么处理）
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.includes(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 归一化链接注解列表。
 *
 * @param annotations 注解列表
 * @param pageWidth 页面宽度（pt，归一化用）
 * @param pageHeight 页面高度（pt）
 * @returns 归一化链接列表
 */
export function normalizeLinks(
  annotations: LinkAnnotationLike[] | undefined | null,
  pageWidth: number,
  pageHeight: number,
): NormalizedLink[] {
  if (!annotations || annotations.length === 0 || pageWidth <= 0 || pageHeight <= 0) {
    return [];
  }

  const result: NormalizedLink[] = [];

  for (const annotation of annotations) {
    const rect = annotation.rect;
    if (!rect || rect.length < 4) {
      continue;
    }

    const x1 = rect[0];
    const y1 = rect[1];
    const x2 = rect[2];
    const y2 = rect[3];

    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      continue;
    }

    // PDF 的 y 轴向上 → 归一化用 [0,1] 且**翻转 y**（与 canvas 坐标一致）
    const normalizedX1 = Math.min(x1, x2) / pageWidth;
    const normalizedX2 = Math.max(x1, x2) / pageWidth;
    // y 翻转：PDF 顶部是 y=pageHeight
    const normalizedY1 = 1 - Math.max(y1, y2) / pageHeight;
    const normalizedY2 = 1 - Math.min(y1, y2) / pageHeight;

    // 外部 URL：过滤不安全协议
    const url = annotation.url && isSafeUrl(annotation.url) ? annotation.url : null;

    // 内部跳转：dest 非空即可（页码由宿主解析）
    const dest = annotation.dest ?? null;

    if (!url && !dest) {
      continue;
    }

    result.push({
      id: `${result.length}-${Math.round(normalizedX1 * 1000)}-${Math.round(normalizedY1 * 1000)}`,
      rect: {
        x1: normalizedX1,
        y1: normalizedY1,
        x2: normalizedX2,
        y2: normalizedY2,
        width: pageWidth,
        height: pageHeight,
      },
      url,
      dest,
    });
  }

  return result;
}

/**
 * 判断点是否落在链接内（命中测试）。
 *
 * @param link 链接
 * @param x 归一化 x
 * @param y 归一化 y
 * @returns 是否命中
 */
export function hitTestLink(link: NormalizedLink, x: number, y: number): boolean {
  return x >= link.rect.x1 && x <= link.rect.x2 && y >= link.rect.y1 && y <= link.rect.y2;
}

/**
 * 从归一化坐标算视口像素矩形。
 *
 * @param link 链接
 * @param viewportWidth 视口宽（px）
 * @param viewportHeight 视口高（px）
 * @returns 视口矩形
 */
export function linkToViewRect(
  link: NormalizedLink,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: link.rect.x1 * viewportWidth,
    top: link.rect.y1 * viewportHeight,
    width: (link.rect.x2 - link.rect.x1) * viewportWidth,
    height: (link.rect.y2 - link.rect.y1) * viewportHeight,
  };
}
