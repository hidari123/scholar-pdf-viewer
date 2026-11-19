/**
 * Icon —— 包的**图标组件**（内置图标集 + 宿主可覆盖）。
 *
 * ## 用法
 *
 * ```tsx
 * <Icon name="upload" />
 * <Icon name="download" size={20} />
 * ```
 *
 * ## 宿主覆盖（重要）
 *
 * 用户反馈："按钮不好看 上传下载 添加高亮这些 都不好看 再找一些图标插件"
 *
 * → 宿主可能有自己的图标体系（比如 `lucide-react`）
 * → 所以**包支持逐个图标覆盖**：
 *
 * ```tsx
 * <PdfViewer icons={{ upload: <Upload />, download: <Download /> }} />
 * ```
 *
 * → 覆盖优先级：**宿主 > 内置** ✅
 */

import type { ReactNode } from 'react';
import type { IconName } from '../core/icons/icons';
import { getIconShape } from '../core/icons/icons';

export type { IconName } from '../core/icons/icons';

/** 图标组件参数 */
export interface IconProps {
  /** 图标名 */
  name: IconName;
  /** 尺寸（px，默认 18） */
  size?: number;
  /** 无障碍标题（默认用图标名） */
  title?: string;
  /** 额外 class */
  className?: string;
  /**
   * **宿主的图标覆盖表**。
   *
   * ⚠️ **宿主优先** → 宿主想用自己的图标体系（`lucide-react` 等）随时可以换 ✅
   */
  overrides?: Partial<Record<IconName, ReactNode>>;
}

/**
 * 图标。
 *
 * @param props 参数
 */
export function Icon({ name, size = 18, title, className, overrides }: IconProps) {
  // ⚠️ **宿主覆盖优先** → 宿主的图标体系优先于内置的
  const override = overrides?.[name];
  if (override !== undefined && override !== null) {
    return <>{override}</>;
  }

  const shape = getIconShape(name);
  if (!shape) {
    return null;
  }

  const label = title ?? name;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      role="presentation"
      className={className}
    >
      <title>{label}</title>
      {shape.fills?.map((d) => (
        <path key={`f-${d}`} d={d} fill="currentColor" stroke="none" />
      ))}
      {shape.paths?.map((d) => (
        <path key={`p-${d}`} d={d} />
      ))}
      {shape.circles?.map((c) => (
        <circle key={`c-${c.cx}-${c.cy}-${c.r}`} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      {shape.rects?.map((r) => (
        <rect
          key={`r-${r.x}-${r.y}-${r.width}-${r.height}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={r.rx}
        />
      ))}
      {shape.lines?.map((l) => (
        <line key={`l-${l.x1}-${l.y1}-${l.x2}-${l.y2}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
      {shape.polylines?.map((p) => (
        <polyline key={`pl-${p.points}`} points={p.points} />
      ))}
    </svg>
  );
}

/**
 * **图标覆盖表**（宿主 → 包）。
 *
 * ⚠️ **只用宿主给了的图标覆盖**，其余用内置的。
 *
 * @param name 图标名
 * @param overrides 宿主的覆盖表
 * @returns 宿主的图标（没有则 `null`）
 */
export function resolveIcon(name: IconName, overrides?: Partial<Record<IconName, ReactNode>>) {
  return overrides?.[name] ?? null;
}
