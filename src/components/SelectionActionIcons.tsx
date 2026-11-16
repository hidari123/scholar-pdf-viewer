/**
 * 选区浮层的**内置图标**（纯 SVG，零依赖）。
 *
 * 为什么自己画：
 * - 包要**零第三方依赖**（不能为了几个图标引入一个图标库）
 * - 图标风格要跟包的主题一致（`currentColor`）
 *
 * 尺寸统一 16×16（`viewBox="0 0 16 16"`），描边风格统一。
 */

import type { SelectionActionIcon } from '../core/selection/actions';

/** 图标组件参数 */
export interface SelectionActionIconProps {
  /** 图标名 */
  name: SelectionActionIcon;
  /** 尺寸（px） */
  size?: number;
}

/**
 * 内置图标。
 *
 * @param props 参数
 */
export function SelectionActionIconView({ name, size = 16 }: SelectionActionIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
    focusable: false,
    role: 'presentation',
  } as const;

  /*
   * 图标是**装饰性**的（旁边有 aria-label 的按钮）→ 无障碍上应被忽略。
   * 但 `noSvgWithoutTitle` 规则要求每个 svg 有**字面量**的 `<title>`。
   * → 每个分支内联一个（配合 `aria-hidden` 仍会被辅助技术忽略）。
   */

  switch (name) {
    case 'highlight':
      // 荧光笔笔身 + 笔尖
      return (
        <svg {...common}>
          <title>highlight</title>
          <path d="M3 11.5 L8.5 6 L11 8.5 L5.5 14 H3 V11.5 Z" fill="currentColor" opacity="0.85" />
          <path d="M9.5 5 L11 3.5 L13.5 6 L12 7.5 L9.5 5 Z" fill="currentColor" />
          <path d="M2 15 H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case 'copy':
      // 两张重叠的纸
      return (
        <svg {...common}>
          <title>copy</title>{' '}
          <rect
            x="5.5"
            y="5.5"
            width="8"
            height="9"
            rx="1.4"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M10.5 5.5V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v7.2c0 .8.6 1.4 1.4 1.4h1.6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'translate':
      // "文A" 风格的翻译符号
      return (
        <svg {...common}>
          <title>translate</title>{' '}
          <path
            d="M2 4 H8 M5 4 V3 M3.2 4 C3.8 6.4 5 7.6 6.8 8.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M6.6 6.6 C6 8.2 5 9.4 3.6 10.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M8.5 13.4 L11.8 6.6 L15.1 13.4 M9.8 11 H13.8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'note':
      // 笔记本 + 笔
      return (
        <svg {...common}>
          <title>note</title>{' '}
          <path
            d="M3 3.4c0-.7.6-1.4 1.4-1.4h5.2L13 5.4v7.2c0 .8-.6 1.4-1.4 1.4H4.4c-.8 0-1.4-.6-1.4-1.4V3.4Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M9.4 2.2V5.4H13"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M5.6 8.4 H9.4 M5.6 10.8 H8.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'ask':
      // 对话气泡 + 问号
      return (
        <svg {...common}>
          <title>ask</title>{' '}
          <path
            d="M13.6 7.6c0 2.7-2.5 4.9-5.6 4.9-.7 0-1.4-.1-2-.3l-3 1.1.8-2.5c-.9-.8-1.4-1.9-1.4-3.2C2.4 4.9 4.9 2.7 8 2.7s5.6 2.2 5.6 4.9Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M7.1 6.4c0-.7.6-1.2 1.3-1.2.7 0 1.3.5 1.3 1.2 0 .9-1.3 1-1.3 1.9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="8.4" cy="9.9" r="0.85" fill="currentColor" />
        </svg>
      );

    case 'explain':
      // 灯泡
      return (
        <svg {...common}>
          <title>explain</title>{' '}
          <path
            d="M8 2.2a4.2 4.2 0 0 0-2.6 7.5c.5.4.8 1 .8 1.6h3.6c0-.6.3-1.2.8-1.6A4.2 4.2 0 0 0 8 2.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M6.2 12.8h3.6 M6.8 14.4h2.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'delete':
      // 垃圾桶
      return (
        <svg {...common}>
          <title>delete</title>{' '}
          <path
            d="M2.8 4.4h10.4 M6 4.4V3.2c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M4.2 4.4h7.6l-.7 8.5c0 .6-.5 1.1-1.1 1.1H6c-.6 0-1.1-.5-1.1-1.1L4.2 4.4Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <title>action</title>{' '}
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
  }
}
