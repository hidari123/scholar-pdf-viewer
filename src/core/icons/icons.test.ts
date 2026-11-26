/**
 * 图标集的测试。
 *
 * 用户反馈："按钮不好看 上传下载 添加高亮这些 都不好看 再找一些图标插件"
 * → 所以图标系统必须有**测试守护**（防止某个图标画坏了 / 漏了）。
 */

import { describe, expect, it } from 'vitest';
import type { IconName } from './icons';
import { getIconShape } from './icons';

/** 全部内置图标名（用于遍历检查） */
const ALL_ICONS: IconName[] = [
  'chevronLeft',
  'chevronRight',
  'chevronUp',
  'chevronDown',
  'arrowLeft',
  'arrowRight',
  'zoomIn',
  'zoomOut',
  'fitWidth',
  'fitPage',
  'rotate',
  'search',
  'thumbnails',
  'outline',
  'print',
  'upload',
  'download',
  'file',
  'fileText',
  'exportJson',
  'exportPdf',
  'highlight',
  'highlightColor',
  'comment',
  'copy',
  'trash',
  'more',
  'note',
  'stickyNote',
  'translate',
  'ask',
  'explain',
  'plus',
  'minus',
  'close',
  'check',
  'edit',
  'link',
  'bold',
  'italic',
  'underline',
  'textColor',
  'textHighlight',
  'list',
  'listOrdered',
  'menu',
  'settings',
];

describe('内置图标集', () => {
  it('**每个图标都有几何数据**（不能是空壳）', () => {
    for (const name of ALL_ICONS) {
      const shape = getIconShape(name);
      expect(shape, `图标 "${name}" 缺几何数据`).toBeTruthy();

      const hasSomething =
        (shape?.paths?.length ?? 0) > 0 ||
        (shape?.fills?.length ?? 0) > 0 ||
        (shape?.circles?.length ?? 0) > 0 ||
        (shape?.rects?.length ?? 0) > 0 ||
        (shape?.lines?.length ?? 0) > 0 ||
        (shape?.polylines?.length ?? 0) > 0;

      expect(hasSomething, `图标 "${name}" 什么形状都没有`).toBe(true);
    }
  });

  /*
   * ⚠️ **颜色相关的图标必须各不相同**（用户反馈：
   * "清空format这个功能的按钮和修改文字颜色的按钮一样 需要区分开"）。
   */
  it('**颜色相关的图标互不相同**（用户分不清哪个是哪个）', () => {
    const colorIcons: IconName[] = ['highlightColor', 'textHighlight', 'textColor', 'clearFormat'];
    const shapes = colorIcons.map((name) => JSON.stringify(getIconShape(name)));
    expect(new Set(shapes).size, '颜色图标有重复的').toBe(colorIcons.length);
  });

  it('**坐标都在 24×24 的画布内**（防止图标被裁掉）', () => {
    for (const name of ALL_ICONS) {
      const shape = getIconShape(name);
      if (!shape) continue;

      for (const rect of shape.rects ?? []) {
        expect(rect.x, `${name} 的 rect.x 越界`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${name} 的 rect.y 越界`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width, `${name} 的 rect 右边越界`).toBeLessThanOrEqual(24);
        expect(rect.y + rect.height, `${name} 的 rect 下边越界`).toBeLessThanOrEqual(24);
      }

      for (const circle of shape.circles ?? []) {
        expect(circle.cx - circle.r, `${name} 的圆左边越界`).toBeGreaterThanOrEqual(0);
        expect(circle.cy - circle.r, `${name} 的圆上边越界`).toBeGreaterThanOrEqual(0);
        expect(circle.cx + circle.r, `${name} 的圆右边越界`).toBeLessThanOrEqual(24);
        expect(circle.cy + circle.r, `${name} 的圆下边越界`).toBeLessThanOrEqual(24);
      }

      for (const line of shape.lines ?? []) {
        expect(Math.min(line.x1, line.x2), `${name} 的线左边越界`).toBeGreaterThanOrEqual(0);
        expect(Math.max(line.x1, line.x2), `${name} 的线右边越界`).toBeLessThanOrEqual(24);
        expect(Math.min(line.y1, line.y2), `${name} 的线上边越界`).toBeGreaterThanOrEqual(0);
        expect(Math.max(line.y1, line.y2), `${name} 的线下边越界`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('**路径不能有空字符串**（空路径会让 SVG 渲染出坏块）', () => {
    for (const name of ALL_ICONS) {
      const shape = getIconShape(name);
      for (const d of shape?.paths ?? []) {
        expect(d.trim().length, `${name} 有空路径`).toBeGreaterThan(0);
      }
      for (const d of shape?.fills ?? []) {
        expect(d.trim().length, `${name} 有空填充路径`).toBeGreaterThan(0);
      }
    }
  });

  it('**上传和下载的箭头方向相反**（方向画反了最容易被忽略）', () => {
    const upload = getIconShape('upload');
    const download = getIconShape('download');

    /*
     * ⚠️ **按几何判断**（不是按路径字符串）→ 改了画法也不会失效。
     *
     * → 上传：箭头的**竖线**从下往上（y 大 → y 小）
     * → 下载：箭头的**竖线**从上往下（y 小 → y 大）
     */
    const arrowOf = (shape: { paths?: readonly string[] } | null) =>
      shape?.paths?.find((d) => /^M12 [\d.]+v-?[\d.]+$/.test(d)) ?? '';

    expect(arrowOf(upload)).toMatch(/^M12 [\d.]+v-/);
    expect(arrowOf(download)).toMatch(/^M12 [\d.]+v[^-]/);
  });

  it('**上传/下载的箭头在云里（不戳出云顶）**（用户反馈："箭头放的位置也不对 超出来了"）', () => {
    for (const name of ['upload', 'download'] as const) {
      const shape = getIconShape(name);
      const arrow = shape?.paths?.find((d) => /^M12 [\d.]+v-?[\d.]+$/.test(d)) ?? '';

      // 箭头的竖线：从尾部（y 大）到尖端（y 小）
      const match = /^M12 ([\d.]+)v(-?)([\d.]+)$/.exec(arrow);
      expect(match, `${name} 找不到箭头的竖线`).toBeTruthy();

      const startY = Number(match?.[1]);
      const length = Number(match?.[3]);
      const tipY = startY - length;

      // 箭头的**尖端**不能贴边（要留余量）
      expect(tipY).toBeGreaterThanOrEqual(2);
      expect(tipY).toBeLessThanOrEqual(16);
      // 箭头的**尾部**也要留余量
      expect(startY).toBeLessThanOrEqual(19);
    }
  });

  it('**复制图标的两张纸一样大**（用户反馈："复制…挤压在一起了"）', () => {
    const shape = getIconShape('copy');

    // 后面那张纸：一个规整的矩形（12×12）
    const rects = shape?.rects ?? [];
    expect(rects.length).toBe(1);
    expect(rects[0]?.width).toBe(12);
    expect(rects[0]?.height).toBe(12);
    expect(rects[0]?.x).toBe(9);
    expect(rects[0]?.y).toBe(9);

    // 前面那张纸：一条折线（只画露出来的上边和左边）
    const paths = shape?.paths ?? [];
    expect(paths.length).toBe(1);
    // 前面那张从 (3,3) 开始 → 和后面那张一样是 12×12
    expect(paths[0]).toContain('M15 3');
    expect(paths[0]).toContain('v10');
  });

  it('**翻译图标的"文"和"A"不重叠**（用户反馈："翻译…挤压在一起了"）', () => {
    const shape = getIconShape('translate');
    const paths = shape?.paths ?? [];

    /*
     * ⚠️ **按几何判断**（不按路径字符串）→ 以后改画法也不会失效。
     *
     * → "文"的 x 范围 和 "A"的 x 范围 **不能相交**
     */
    // "文" = 前 4 条路径，"A" = 后 2 条
    const wenPaths = paths.slice(0, 4);
    const aPaths = paths.slice(4);

    /*
     * → "文" 的所有路径的 x 都要 < "A" 的最小 x
     * → 直接取每条路径的**绝对起点 x**（M 后面第一个数）
     */
    const startX = (d: string) => {
      const m = /^M(-?\d+(\.\d+)?)/.exec(d);
      return m?.[1] === undefined ? Number.NaN : Number(m[1]);
    };

    const wenRight = Math.max(...wenPaths.map(startX));
    const aLeft = Math.min(...aPaths.map(startX));

    expect(wenRight).toBeLessThan(aLeft);
  });

  it('**未知图标返回 null**（不抛异常）', () => {
    expect(getIconShape('not-exist' as IconName)).toBeNull();
  });
});

/*
 * ⚠️ **新图标不能和旧图标重复**（用户反馈：
 * "导入高亮这个icon可否再设计 目前像是上传pdf"❌
 * "导出带高亮的pdf这个icon可以作为下载pdf，导出带高亮的pdf的icon再设计一下"❌）。
 */
describe('新图标', () => {
  it('**importJson 和 upload 不一样**（不然还是像上传 PDF）', () => {
    const imported = getIconShape('importJson');
    const uploaded = getIconShape('upload');
    expect(imported).toBeTruthy();
    expect(uploaded).toBeTruthy();
    expect(JSON.stringify(imported)).not.toBe(JSON.stringify(uploaded));
  });

  it('**exportAnnotated 和 exportPdf 不一样**（不然和"下载 PDF"重复）', () => {
    const annotated = getIconShape('exportAnnotated');
    const plain = getIconShape('exportPdf');
    const download = getIconShape('download');
    expect(annotated).toBeTruthy();
    expect(JSON.stringify(annotated)).not.toBe(JSON.stringify(plain));
    expect(JSON.stringify(annotated)).not.toBe(JSON.stringify(download));
  });

  it('**palette（主题）也有形状**', () => {
    expect(getIconShape('palette')).toBeTruthy();
  });
});
