/**
 * **富文本** —— 轻量的富文本模型 + HTML 序列化。
 *
 * ## 用户需求
 *
 * > "而且输入框不要用默认的 你设计一个好看点的富文本输入框
 * >  调研一个好用的富文本插件 可以自主控制展示哪些富文本内容
 * >  通过宿主接口配置 提供默认的一些 比如高亮 加粗 颜色 链接"
 *
 * ## 调研：富文本插件选型
 *
 * | 方案                | 优点                       | 否决原因                                       |
 * | ------------------- | -------------------------- | ---------------------------------------------- |
 * | `@tiptap/react` + `starter-kit` | headless、模块化、**工具栏完全宿主可控**、恰好有 高亮/加粗/颜色/链接 | **体积远超 25 kB 预算**（tiptap core + starter-kit + 5 个扩展 ≈ 100+ kB gzip）❌ |
 * | `lexical`           | 性能好                     | 同样超预算，且**必须**配合 React 插件一起用      |
 * | `quill` / `react-quill` | 成熟、API 友好        | 同样超预算；`quill` 还会**接管** DOM（宿主不好控制样式） |
 *
 * **→ 折中：包内自研一个"够用"的富文本**（`contenteditable` + `document.execCommand`）
 * + **工具栏完全由宿主配置**（和 `selectionActions` 一个思路）。
 *
 * ## 为什么 `document.execCommand` 够用
 *
 * - 它是**浏览器原生**的富文本命令接口（`bold` / `hiliteColor` / `createLink` …）
 * - 零依赖、零体积
 * - 输出的 HTML 是**标准富文本 HTML**（`<b>` / `<mark style="background-color:…">` / `<a href>`）
 * - ⚠️ 已废弃但**所有主流浏览器仍支持**，且是 contenteditable 场景的**事实标准**
 *
 * ## 包的边界
 *
 * → 包只给**编辑区 + 工具栏 UI + 命令执行**
 * → **存什么、存哪、怎么存** → 宿主的事（和批注一样）
 */

import type { IconName } from '../icons/icons';

/** 富文本的**命令**（工具栏的一个按钮） */
export type RichTextCommand =
  /** 加粗 */
  | 'bold'
  /** 斜体 */
  | 'italic'
  /** 下划线 */
  | 'underline'
  /** 删除线 */
  | 'strikeThrough'
  /** 高亮（背景色） */
  | 'hiliteColor'
  /**
   * **文字高亮**（背景色，**字色不变**）。
   *
   * ⚠️ **和 `hiliteColor` 的区别**：
   * -> `hiliteColor` = 荧光笔效果（背景色 + 可能带浅色）
   * -> `textHighlight` = 纯背景色，**字色完全不变** ✅（用户需求：
   *    "这个颜色可以放在文字的高亮上"）
   *
   * ⚠️⚠️ **不在默认工具栏里**（用户反馈："功能和高亮重复了而且图标很丑"）❌
   * -> 宿主可以自己在 `annotationToolbar` 里加回来 ✅
   */
  | 'textHighlight'
  /** 文字颜色 */
  | 'foreColor'
  /** 链接 */
  | 'createLink'
  /** 无序列表 */
  | 'insertUnorderedList'
  /** 有序列表 */
  | 'insertOrderedList'
  /** 引用 */
  | 'formatBlock'
  /** 清除格式 */
  | 'removeFormat'
  /** 撤销 */
  | 'undo'
  /** 重做 */
  | 'redo';

/** 高亮的预设颜色 */
export interface RichTextPalette {
  /** 语义 key → 颜色 */
  [key: string]: string;
}

/**
 * 工具栏按钮的**默认配置**。
 *
 * ⚠️ **宿主可以完全覆盖**（通过 `toolbar` prop）→ 只显示想展示的 ✅
 *
 * ⚠️ **label 支持 i18n 占位符**：传 `{key}` 形式 → 由 `RichTextEditor` 解析。
 *    不传 label → 用命令名（英文，可用但不是本地化的）
 *
 * ## 默认包含哪些（用户需求："工具栏可以的"）
 *
 * | 按钮 | 命令 | 状态 |
 * |---|---|---|
 * | B 加粗 | `bold` | ✅ |
 * | I 斜体 | `italic` | ✅ |
 * | U 下划线 | `underline` | ✅ |
 * | S 删除线 | `strikeThrough` | ✅ |
 * | 高亮底色 | `hiliteColor` | ✅（有 palette 时） |
 * | A 文字颜色 | `foreColor` | ✅ |
 *
 * ⚠️ **`textHighlight`（文字高亮）不在默认工具栏里**（用户反馈："功能重复 + 图标很丑"）❌
 * -> 但**命令和图标保留** -> 宿主可自己加回来 ✅
 * | 链接 | `createLink` | ✅ |
 * | 无序列表 | `insertUnorderedList` | ✅ |
 * | 有序列表 | `insertOrderedList` | ✅ |
 * | 引用 | `formatBlock` | ✅ |
 * | 清除格式 | `removeFormat` | ✅ |
 * | 撤销 | `undo` | ✅ |
 * | 重做 | `redo` | ✅ |
 *
 * ## ⚠️⚠️ **文字颜色必须用【深色】色板**（用户反馈："如果是放在文字上 就太浅了"）
 *
 * -> `palette`（高亮底色）= **浅色**（\`#fff3a3\` 这种）✅
 * -> 拿来当**文字颜色** -> **浅得看不见** ❌
 * -> 所以 `foreColor` **必须**用 `textPalette`（深色）✅
 *
 * @param palette 高亮色板（用于 `hiliteColor` / `textHighlight`）
 * @param textPalette **文字颜色**色板（深色，用于 `foreColor`）
 * @returns 默认工具栏项
 */
export function defaultRichTextToolbar(
  palette?: RichTextPalette,
  textPalette?: RichTextPalette,
): RichTextToolbarItem[] {
  const items: RichTextToolbarItem[] = [
    { command: 'bold', label: '{richtext.bold}', icon: 'bold' },
    { command: 'italic', label: '{richtext.italic}', icon: 'italic' },
    { command: 'underline', label: '{richtext.underline}', icon: 'underline' },
    { command: 'strikeThrough', label: '{richtext.strikeThrough}', icon: 'strike' },
  ];

  if (palette) {
    items.push({
      command: 'hiliteColor',
      label: '{richtext.highlight}',
      icon: 'highlightColor',
      palette,
    });
  }

  /*
   * ⚠️⚠️ **"文字高亮"按钮已从默认工具栏移除**（用户反馈：
   * "把富文本编辑框里的文字高亮这个按钮去掉吧 功能和高亮重复了而且图标很丑"）。
   *
   * ### 为什么去掉
   *
   * -> 实现上它就是 \`hiliteColor\` 的**别名** ✅
   *    -> \`execCommand(command === 'textHighlight' ? 'hiliteColor' : command, ...)\` ✅
   * -> 功能**完全重复** ❌
   * -> 图标（"A" + 背景块）**不好看** ❌
   *
   * ### 但是**命令和图标保留**
   *
   * -> 宿主可以自己在 \`annotationToolbar\` 里加回来 ✅
   * -> 命令（\`textHighlight\`）保留 -> 宿主的自定义工具栏能用 ✅
   * -> 图标（\`textHighlight\`）保留 -> 宿主想用能用 ✅
   * -> **不破坏**已有宿主的自定义工具栏 ✅
   */

  items.push(
    // ⚠️ **文字颜色用【深色】色板**（浅色当字色看不见）✅
    {
      command: 'foreColor',
      label: '{richtext.textColor}',
      icon: 'textColor',
      palette: textPalette,
    },
    { command: 'createLink', label: '{richtext.link}', icon: 'link' },
    { command: 'insertUnorderedList', label: '{richtext.unorderedList}', icon: 'list' },
    { command: 'insertOrderedList', label: '{richtext.orderedList}', icon: 'listOrdered' },
    { command: 'formatBlock', label: '{richtext.quote}', icon: 'quote' },
    { command: 'removeFormat', label: '{richtext.clearFormat}', icon: 'clearFormat' },
    { command: 'undo', label: '{richtext.undo}', icon: 'undo' },
    { command: 'redo', label: '{richtext.redo}', icon: 'redo' },
  );

  return items;
}

/** 工具栏的一项 */
export interface RichTextToolbarItem {
  /** 命令 */
  command: RichTextCommand;
  /** 提示文案（也用作 aria-label） */
  label: string;
  /**
   * 图标名（内置图标集）。
   *
   * ⚠️ **之前是 `string`**（审计发现的 bug）：
   * -> 宿主拼错（\`icon: 'bolder'\`）**编译通过** ❌
   *   -> 渲染出来是**空白图标** ❌（用户看着像"按钮坏了"）
   * -> 现在：**\`IconName\`** -> 拼错**直接编译报错** ✅
   */
  icon?: IconName;
  /** 颜色面板（`hiliteColor` / `foreColor` 用） */
  palette?: RichTextPalette;
  /** 分组（同组的相邻，组间有分隔线） */
  group?: string;
  /** 排序 */
  order?: number;
}

/**
 * 执行一个富文本命令。
 *
 * ⚠️ **必须在用户手势里调用**（`execCommand` 的限制）。
 *
 * ## ⚠️⚠️ **颜色命令必须用 `styleWithCSS`**（审计发现的**真 bug**）
 *
 * ### 之前的问题
 *
 * ```tsx
 * document.execCommand('foreColor', false, '#ff0000');
 * // → 生成：<font color="#ff0000">文字</font>     ❌
 * ```
 *
 * -> \`<font>\` **不在 \`sanitizeRichText\` 的白名单里** ❌
 *   -> 清洗时**整个标签被替换成纯文本** ❌
 *   -> 实测：\`"<font color="#ff0000">World</font>"\` -> \`"World"\` ❌
 *      -> **颜色完全丢失** ❌
 *   -> 用户看到：**点了"文字颜色"一点反应都没有** ✅
 *
 * ### 现在的做法
 *
 * -> \`styleWithCSS = true\` -> 浏览器生成 **\`<span style="color:#ff0000">\`** ✅
 *   -> \`<span>\` **在白名单里** ✅
 *   -> 而且 \`span\` 的 style **只保留 color / background-color** ✅
 *   -> **颜色保住了** ✅
 *   -> 顺带：**输出更干净**（不用为 \`<font>\` 破例）✅
 *
 * @param command 命令
 * @param value 命令的值（颜色 / 链接地址 / 块类型）
 */
export function execRichTextCommand(command: RichTextCommand, value?: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  /*
   * ⚠️⚠️ **颜色命令要先开 \`styleWithCSS\`**（审计发现的**真 bug**）。
   *
   * -> 不开的话 \`foreColor\` 生成 **\`<font color="#ff0000">\`** ❌
   *   -> \`<font>\` **不在 \`sanitizeRichText\` 的白名单里** ❌
   *   -> 清洗时**整个标签被替换成纯文本** -> **颜色完全丢失** ❌
   *   -> 用户看到：**点了"文字颜色"一点反应都没有** ✅
   *
   * -> 开了之后生成 **\`<span style="color: rgb(255,0,0)">\`** ✅
   *   -> \`<span>\` **在白名单里** ✅
   *   -> 而且 \`span\` 的 style **只保留 color / background-color** ✅
   *   -> **颜色保住了** ✅
   *
   * ⚠️ **实测确认**（不是猜的）：
   * ```
   * execCommand('foreColor', false, '#ff0000')          → <font color="#ff0000">
   * execCommand('styleWithCSS', false, 'true')  再执行  → <span style="color: rgb(255,0,0)">
   * ```
   */
  if (command === 'hiliteColor' || command === 'foreColor' || command === 'textHighlight') {
    // ⚠️ **先开 CSS 模式**（全局状态，但只在执行前设置一次）
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      // 浏览器不支持 -> 退回默认（会生成 <font>，但至少不崩）
    }
    /*
     * ⚠️ **"文字高亮" -> 用 `hiliteColor` 实现**（用户需求：
     * "这个颜色可以放在文字的高亮上 增加一个添加文字高亮的按钮"）。
     *
     * -> `hiliteColor` 在浏览器里就是**设置背景色** ✅
     * -> **不会改字色** ✅ -> 正好是"文字高亮"要的效果 ✅
     */
    document.execCommand(
      command === 'textHighlight' ? 'hiliteColor' : command,
      false,
      value ?? '#ffff00',
    );
    return;
  }

  switch (command) {
    case 'formatBlock':
      document.execCommand(command, false, value ?? 'blockquote');
      break;
    case 'createLink':
      document.execCommand(command, false, value ?? '');
      break;
    default:
      document.execCommand(command, false, value);
  }
}

/**
 * **取纯文本**（去掉所有标签）。
 *
 * ⚠️ 批注列表 / 搜索索引用这个（不关心格式）。
 *
 * @param html 富文本 HTML
 * @returns 纯文本
 */
export function richTextToPlain(html: string): string {
  if (typeof document === 'undefined') {
    // SSR / Node → 粗暴去标签
    return html.replace(/<[^>]*>/g, '');
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return (holder.textContent ?? '').replace(/ /g, ' ').trim();
}

/**
 * **是不是一个"纯颜色值"？**
 *
 * ⚠️ 审计发现的**真实漏洞**：
 * -> 之前的正则 \`([^;]+)\` 会把 \`url(javascript:...)\` 一起吞掉 ❌
 * -> 所以现在**只认纯颜色** ✅
 *
 * 允许：
 * - \`#rgb\` / \`#rgba\` / \`#rrggbb\` / \`#rrggbbaa\`
 * - \`rgb(...)\` / \`rgba(...)\`（数字或百分比）
 * - 常见颜色名（white / black / red …）
 *
 * 不允许：
 * - 任何含 \`url(\` / \`expression(\` / \`\`（转义）/ \`/*\`（注释）的值 ❌
 *
 * @param value CSS 值（已 trim）
 * @returns 是不是安全的纯颜色
 */
function isPlainColor(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 64) {
    return false;
  }
  // ⚠️ **含这些的一律拒绝**（即使长得像颜色）❌
  if (/url\s*\(|expression\s*\(|image-set\s*\(|@import|[\\/*]|\(\s*['"]/i.test(v)) {
    return false;
  }
  // 十六进制
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
    return true;
  }
  // rgb / rgba / hsl / hsla（内容只能是数字、百分比、逗号、空格、点号）
  if (/^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s]+\)$/i.test(v)) {
    return true;
  }
  // 颜色名（只认字母）
  if (/^[a-z]{3,30}$/i.test(v)) {
    return true;
  }
  return false;
}

/**
 * **清洗 HTML**（只保留安全的标签）。
 *
 * ⚠️ 批注内容会存到宿主的后端 → **可能 XSS** → 必须清洗 ✅
 *
 * 保留的标签：`b` `i` `u` `s` `mark` `a` `ul` `ol` `li` `blockquote` `br` `span` `code`
 *
 * @param html 原始 HTML
 * @returns 清洗后的 HTML
 */
export function sanitizeRichText(html: string): string {
  if (typeof document === 'undefined') {
    return html;
  }

  const holder = document.createElement('div');
  holder.innerHTML = html;

  const ALLOWED = new Set([
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'STRIKE',
    'MARK',
    'A',
    'UL',
    'OL',
    'LI',
    'BLOCKQUOTE',
    'BR',
    'SPAN',
    'CODE',
    'P',
    'DIV',
  ]);

  // 递归清洗
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (!ALLOWED.has(child.tagName)) {
        // 不允许的标签 → **只保留文字**，丢掉标签本身
        const text = document.createTextNode(child.textContent ?? '');
        child.replaceWith(text);
        continue;
      }
      walk(child);
    }
  };
  walk(holder);

  // 去掉所有属性（除了 `<a href>` 和 `<span style>` 的颜色）
  for (const el of holder.querySelectorAll('*')) {
    const tag = el.tagName;

    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      // ⚠️ 只允许 http/https/mailto（防 javascript: 伪协议）
      if (!/^(https?:|mailto:)/i.test(href)) {
        el.removeAttribute('href');
      } else {
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
      continue;
    }

    if (tag === 'SPAN' || tag === 'MARK') {
      /*
       * ⚠️⚠️ **只保留颜色相关的 style**（审计发现的**真实漏洞**）。
       *
       * ### 之前的漏洞
       *
       * ```js
       * const color = /(^|;)\s*(background-color|color)\s*:\s*([^;]+)/i.exec(style);
       * ```
       *
       * -> 值组 \`[^;]+\` **会把 \`url(...)\` 一起吞掉** ❌
       * -> \`background-color:url(javascript:alert(1))\` **能通过** ❌
       *   （实测：清洗后原样保留 -> **XSS** ❌）
       *
       * ### 现在的修法
       *
       * -> 值里**不允许出现 \`url(\` / \`expression(\` / \`image-set(\`** -> 直接丢掉 ✅
       * -> 也不允许 \`\\`（CSS 转义）-> 防止 \`\\75 rl(...)\` 这种绕过 ✅
       * -> 只保留**纯颜色值**（\`#rgb\` / \`#rrggbb\` / \`rgb(...)\` / \`rgba(...)\` / 颜色名）✅
       */
      const style = el.getAttribute('style') ?? '';
      const match = /(^|;)\s*(background-color|color)\s*:\s*([^;]+)/i.exec(style);
      if (match) {
        const value = match[3] ?? '';
        /*
         * ⚠️ **危险的值直接丢掉**（不"修补"，直接不要）✅
         */
        const dangerous = /url\s*\(|expression\s*\(|image-set\s*\(|@import|\\|\/\*/i.test(value);
        if (!dangerous && isPlainColor(value)) {
          el.setAttribute('style', match[0].trim());
        } else {
          el.removeAttribute('style');
        }
      } else {
        el.removeAttribute('style');
      }
      continue;
    }

    // 其他标签 → 清空所有属性
    for (const attr of [...el.attributes]) {
      el.removeAttribute(attr.name);
    }
  }

  return holder.innerHTML;
}
