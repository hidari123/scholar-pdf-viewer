/**
 * **CSS 隔离**的回归测试。
 *
 * ## 为什么要有这个测试
 *
 * -> 宿主要求："**包的 css 不能影响到宿主**" ✅
 * -> 之前变量定义在 `:root` ✅ -> 那是 `<html>` ✅ -> **整页生效** ✅
 * -> 宿主的 `<html>` 上会多出 20 个 `--scpdf-*` ✅ -> **污染全局命名空间** ✅
 * -> 还有一个全局的 `@page` ✅ -> **改掉了宿主的打印纸张和边距** ✅
 *
 * ## 这个测试防什么
 *
 * -> 以后有人手滑加了个 `:root` / `body` / 裸元素选择器 ✅
 * -> 或者又加了个全局 `@page` ✅
 * -> **测试会红** ✅ -> 不会悄悄漏出去 ✅
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** CSS 源文件目录 */
const STYLE_DIR = join(__dirname);

/** 读一个 CSS 文件 */
function readCss(file: string): string {
  return readFileSync(join(STYLE_DIR, file), 'utf8');
}

/**
 * 去掉注释 ✅
 *
 * -> 不去的话 ✅ -> 注释里的选择器会被误判 ✅
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 找出 CSS 里所有**顶层选择器**（含 @media 内部的 ✅）。
 *
 * -> 简单地按 `{` 切 ✅ -> 会把声明当选择器 ✅
 * -> 所以按"大括号配平"走一遍 ✅
 */
function collectSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';
  let inAtRule = false;

  for (const ch of css) {
    if (ch === '{') {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) {
        // ⚠️ **@media / @supports / @layer 的内容继续往下走 ✅**
        inAtRule = true;
        depth += 1;
        continue;
      }
      if (depth > 0 || !inAtRule) {
        // ⚠️ **普通规则 ✅**
        if (head) {
          selectors.push(head);
        }
      }
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      buffer = '';
      if (depth === 0) {
        inAtRule = false;
      }
      continue;
    }

    if (depth > 0 || !inAtRule) {
      buffer += ch;
    }
  }

  return selectors;
}

/** 允许的"不是选择器"的词 ✅ */
const NOT_SELECTORS = new Set(['from', 'to', 'and', 'not', 'only']);

/** 检查一个选择器是不是"包自己的" ✅ */
function isPackageScoped(selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim());
  return parts.every((part) => {
    if (!part) return true;
    if (NOT_SELECTORS.has(part)) return true;
    // ⚠️ **@page / @keyframes 的名字 ✅**
    if (part.startsWith('@')) return true;
    // ⚠️ **keyframe 的步骤 ✅**
    if (/^\d+$/.test(part)) return true;
    // ⚠️ **包自己的 class ✅**
    if (part.includes('.scpdf')) return true;
    return false;
  });
}

describe('CSS 隔离（不影响宿主 ✅）', () => {
  const files = ['viewer.css', 'themes.css'];

  for (const file of files) {
    describe(file, () => {
      const raw = readCss(file);
      const css = stripComments(raw);

      it('没有全局的 :root 规则', () => {
        // ⚠️ **变量必须定义在 .scpdf-root 上 ✅**
        // -> `:root` = `<html>` ✅ -> 整页生效 ✅ -> 污染宿主 ✅
        expect(css).not.toMatch(/(^|[};])\s*:root\s*\{/);
      });

      it('没有全局的 @page 规则', () => {
        // ⚠️ **@page 是全局的 ✅**
        // -> 它设置**整张打印纸** ✅ -> 宿主的打印被改 ✅
        expect(css).not.toMatch(/@page\s*\{/);
      });

      it('所有选择器都在 .scpdf- 命名空间里', () => {
        const offenders = collectSelectors(css).filter((s) => !isPackageScoped(s));
        expect(offenders).toEqual([]);
      });

      it('没有裸元素选择器（button / input / body …）', () => {
        const bare =
          /(^|[};])\s*(button|input|textarea|select|a|img|svg|body|html|p|div|span|ul|li|table)\s*[,{]/;
        expect(css).not.toMatch(bare);
      });

      it('没有通配选择器 *', () => {
        expect(css).not.toMatch(/(^|[};])\s*\*\s*[,{]/);
      });

      it('没有裸的伪元素（::before / ::after …）', () => {
        expect(css).not.toMatch(
          /(^|[};])\s*::?(before|after|first-line|placeholder|selection|backdrop)\b/,
        );
      });

      it('@keyframes 的名字都带 scpdf- 前缀', () => {
        const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)]
          .map((m) => m[1])
          .filter((n): n is string => Boolean(n));
        for (const name of names) {
          expect(name.startsWith('scpdf-')).toBe(true);
        }
      });
    });
  }

  it('变量定义在 .scpdf-root 上（不是 :root）', () => {
    const css = stripComments(readCss('viewer.css'));
    // ⚠️ **变量必须在 .scpdf-root 里 ✅**
    expect(css).toMatch(/\.scpdf-root\s*\{[^}]*--scpdf-color-primary/);
    expect(css).toMatch(/\.scpdf-root\s*\{[^}]*--scpdf-font-reading/);
  });

  it('主题块也在 .scpdf-root-- 命名空间里', () => {
    const css = stripComments(readCss('themes.css'));
    const offenders = collectSelectors(css).filter((s) => !isPackageScoped(s));
    expect(offenders).toEqual([]);
  });
});
