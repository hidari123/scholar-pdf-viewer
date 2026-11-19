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

    // 上传 = 箭头朝上（v-7 → 往下是 v7）；下载 = 箭头朝下（v11）
    expect(upload?.paths?.some((d) => d.includes('M12 20v-7'))).toBe(true);
    expect(download?.paths?.some((d) => d.includes('M12 4v11'))).toBe(true);
  });

  it('**未知图标返回 null**（不抛异常）', () => {
    expect(getIconShape('not-exist' as IconName)).toBeNull();
  });
});
