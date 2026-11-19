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
 *
 * ## ⚠️ 内置几何数据是**懒加载**的（实测踩过的坑：体积超预算）
 *
 * → 45 个图标的几何数据约 **5 kB**（brotli 后）
 * → 静态 import → 主入口 **27 kB** → 超了 **25 kB** 的预算 ❌
 * → 改成**动态 import** → 第一次用到时才加载 → 主入口保持轻量 ✅
 *
 * → 代价：图标**第一次渲染**是空白的（异步加载）
 * → 缓解：加载后**缓存** → 第二次起同步渲染 ✅
 * → 且**宿主覆盖**的图标**不走这条路**（同步渲染）
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { IconName, IconShape } from '../core/icons/icons';

export type { IconName } from '../core/icons/icons';

/**
 * **图标几何数据的缓存**（懒加载 → 缓存 → 之后同步）。
 *
 * ⚠️ 模块级缓存 → 全局共享 → 只加载一次 ✅
 */
const shapeCache = new Map<IconName, IconShape | null>();

/** 正在加载的 Promise（避免重复加载同一个图标） */
const loading = new Map<IconName, Promise<void>>();

/**
 * 加载一个图标的几何数据。
 *
 * @param name 图标名
 * @returns 加载完成的 Promise
 */
function loadShape(name: IconName): Promise<void> {
  const cached = shapeCache.get(name);
  if (cached !== undefined) {
    return Promise.resolve();
  }

  const pending = loading.get(name);
  if (pending) {
    return pending;
  }

  const promise = import('../core/icons/icons')
    .then((mod) => {
      const shape = mod.getIconShape(name);
      shapeCache.set(name, shape);
    })
    .catch(() => {
      // 加载失败 → 记成 null（不画图标，但**不崩**）
      shapeCache.set(name, null);
    })
    .finally(() => {
      loading.delete(name);
    });

  loading.set(name, promise);
  return promise;
}

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
  /*
   * ⚠️ **懒加载几何数据**（见文件头的说明：体积预算）。
   *
   * → 第一次：缓存里没有 → 触发加载 → 先渲染空
   * → 加载完：写进 state → 重渲染 → 图标出现
   * → 第二次起：缓存里有 → **同步**渲染（无闪烁）✅
   */
  const [shape, setShape] = useState<IconShape | null>(() => shapeCache.get(name) ?? null);

  useEffect(() => {
    // 缓存里已经有了 → 直接用
    const cached = shapeCache.get(name);
    if (cached !== undefined) {
      setShape(cached);
      return;
    }

    let cancelled = false;
    void loadShape(name).then(() => {
      if (!cancelled) {
        setShape(shapeCache.get(name) ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [name]);

  /*
   * ⚠️ **宿主覆盖优先** → 宿主的图标体系优先于内置的。
   *
   * → 必须放在 hooks **之后**（hooks 不能条件调用）
   */
  const override = overrides?.[name];
  if (override !== undefined && override !== null) {
    return <>{override}</>;
  }

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
