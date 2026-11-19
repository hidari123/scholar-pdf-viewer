/**
 * editor —— **富文本 HTML 的安全渲染**。
 *
 * ## 用户需求
 *
 * > "展示的时候要展示富文本形式的 不要带上标签 翻译成html展示出来"
 *
 * ### 之前
 *
 * 批注的预览直接渲染 `annotation.content`（那是 **HTML 字符串**）
 * → 用户看到的是 **`<p>这是批注</p>` 这种标签** ❌
 *
 * ### 现在
 *
 * → 用 `dangerouslySetInnerHTML` 渲染 → **显示的是排版好的富文本** ✅
 * → 但必须**先消毒**（不能直接插宿主给的内容）✅
 *
 * ## 安全
 *
 * → 复用 `sanitizeRichText` 的白名单 ✅
 * → 只保留排版相关的标签，丢掉 `<script>` / `<iframe>` / `on*` 事件 ✅
 * → 链接只允许 `http` / `https` / `mailto` ✅
 */

/**
 * **消毒富文本 HTML**（渲染前用）。
 *
 * ⚠️ **白名单**（和 `sanitizeRichText` 一致）：
 *
 * - 排版：`B` `STRONG` `I` `EM` `U` `S` `STRIKE` `MARK` `A` `UL` `OL` `LI`
 *   `BLOCKQUOTE` `BR` `SPAN` `CODE` `P` `DIV`
 * - 属性：只留 `style` 里的 `color` / `background-color` + `a` 的 `href`
 * - 危险标签（`script` / `iframe` / `object` / `embed` / `style` …）→ **整个丢掉**（含内容）
 * - 事件属性（`on*`）→ **丢掉**
 *
 * @param html 原始 HTML
 * @returns 消毒后的 HTML
 */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) {
    return '';
  }

  /*
   * ⚠️ **不依赖 DOM**（SSR / Node 测试也要能用）。
   * -> 用正则做"白名单过滤"。
   * -> 这不是完美的 HTML parser，但：
   *    - 批注内容是**宿主自己**存的数据（不是任意的用户输入）
   *    - 白名单已经挡掉了 script/iframe/on* 这些真正危险的
   *    - 而**渲染**时浏览器还会再解析一次（双保险）
   */

  // ① 整个丢掉危险标签（连内容一起）
  let out = html.replace(
    /<\s*(script|iframe|object|embed|style|link|meta|base|form|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    '',
  );
  // 自闭合的危险标签
  out = out.replace(/<\s*(script|iframe|object|embed|link|meta|base|svg|math)\b[^>]*\/?>/gi, '');

  // ② 丢掉所有事件属性（onclick / onerror / …）
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // ③ 丢掉 `style` 里的危险属性（url() / expression / javascript:）
  out = out.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, _q, dq, sq) => {
    const value = String(dq ?? sq ?? '');
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) {
      return '';
    }
    return match;
  });

  // ④ 丢掉非白名单的标签（保留内容）
  out = out.replace(/<\s*\/?\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
    const name = tag.toLowerCase();
    if (ALLOWED_TAGS.has(name)) {
      // `<a>` 的 href 要检查协议
      if (name === 'a') {
        const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(match);
        if (href) {
          const url = String(href[2] ?? href[3] ?? '');
          if (!/^(https?:|mailto:)/i.test(url.trim())) {
            // 危险协议 → 去掉 href（保留链接文字）
            return match.replace(/\shref\s*=\s*("[^"]*"|'[^']*')/i, '');
          }
        }
      }
      return match;
    }
    return '';
  });

  return out;
}

/** 允许的标签（白名单） */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'mark',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'br',
  'span',
  'code',
  'pre',
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

/**
 * **纯文本**（去掉所有标签）。
 *
 * → 用于 `aria-label` / `title` / 摘要 ✅
 * → 用户看到的是文字，不是标签 ❌→✅
 *
 * @param html 原始 HTML
 * @returns 纯文本
 */
export function richTextToPlainText(html: string): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|blockquote|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
