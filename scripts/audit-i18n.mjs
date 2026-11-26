/**
 * i18n 审计 —— 检查"硬编码文案"和"文案表完整性"。
 *
 * ## ⚠️⚠️ **之前这个工具漏报**（审计发现的真 bug）
 *
 * -> 旧版的 `labelRe` 是 `/\blabel\s*:\s*(?:'([^']*)'|"([^"]*)")/g`
 *   -> **只匹配"引号字面量"** ❌
 *   -> 而源码写的是 **计算属性**：`label: HIGHLIGHT_ACTION_LABELS[HIGHLIGHT_ACTION_KEYS.comment]` ❌
 *      -> **匹配不到** ❌
 * -> 实测：旧版跑出来"0 个硬编码"，但源码里**实际有 5 处中文** ❌
 *   （`highlight-actions.ts` 的 5 个高亮动作标签）
 * -> 而且高亮浮层**永远是中文** -> 和选区浮层（英文）并排 -> **中英文混杂**
 *
 * ## 现在的做法
 *
 * -> **扫所有 CJK 字符串字面量**（不管它在什么位置、什么写法）
 * -> 加一条**交叉校验**：每个 `Messages` key 必须在**四套内置语言**里都存在
 * -> 加一条**交叉校验**：每个 `Messages` key 必须在 **ZH / EN 两张表**里都存在
 *
 * 用法：`node scripts/audit-i18n.mjs`
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** 收集所有源文件 */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...collect(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = collect(SRC);
const problems = [];

// ————————————————————————————————————————————
// ① 硬编码文案（**扫所有 CJK 字符串字面量**）
// ————————————————————————————————————————————

/**
 * ⚠️ **匹配任何位置的 CJK 字符串字面量**。
 *
 * -> 不再限定是 `label:` / `title=`
 * -> 计算属性（`label: FOO[BAR]`）里的中文**也能抓到**
 * -> 模板字面量（`` `中文 ${x}` ``）也能抓到
 */
const cjkLiteralRe = /(['"`])([^'"`\\\n]*[一-鿿][^'"`\\\n]*)\1/g;

/**
 * **开发者向的中文**（不用翻译）。
 *
 * -> `throw new Error('...')` —— 给开发者看的 ❌
 * -> 翻译了反而难排查
 */
function isDeveloperFacing(context) {
  return (
    context.includes('throw new Error') ||
    context.includes('new TypeError') ||
    context.includes('new RangeError') ||
    /*
     * ⚠️ `pdfViewerError('CODE', { message: '中文' })` —— **开发者向**。
     *
     * -> 这是 `PdfViewerError.message` 的**覆盖值**（排障用）❌
     * -> **UI 层按 `error.code` 取 i18n 文案**  （`PdfViewer.tsx` 的 `t(\`error.\${error.code}\`)`）
     * -> 所以这里的文案**不会显示给用户**  -> 不用翻译
     */
    context.includes('pdfViewerError(')
  );
}

/**
 * **整个对象/常量都是"开发者向"的**（整个文件里出现一次就整块放行）。
 *
 * ⚠️ `core/errors.ts` 的 `DEFAULT_MESSAGES`：
 * -> 它是 `PdfViewerError.message` 的默认值 ❌
 * -> **UI 层已经按 `error.code` 取 i18n 文案了**  （`PdfViewer.tsx:3982`）
 * -> 所以这里的英文**只给宿主排障看** -> 不用翻译
 */
const DEVELOPER_FACING_OBJECTS = ['DEFAULT_MESSAGES', 'THEME_LABELS'];

/**
 * **允许中文的位置**（有正当理由）。
 */
function isAllowedHere(file, context, lineText) {
  // ① 文案表本身（zh 表就是中文的）
  if (file.includes('i18n/messages.ts')) {
    return true;
  }
  // ② 内置语言表（zh / ja / fr 的表里都有中文）
  if (file.includes('builtin-defaults.ts')) {
    return true;
  }
  // ③ 抛给开发者的错误（core + components 都有）
  if (isDeveloperFacing(context)) {
    return true;
  }
  // ④ core 层抛给开发者的错误
  if (file.includes(`${join('core', '')}`) && isDeveloperFacing(context, lineText)) {
    return true;
  }
  return false;
}

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // 去掉注释（避免把注释里的中文当成硬编码）
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // 去掉 import 里的类型名（不会有中文，保险起见）
    .replace(/^import[\s\S]*?;$/gm, '');

  // ⚠️ Windows 的 relative() 用反斜杠 -> 统一成正斜杠（好判断）
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  /*
   * ⚠️ **找出"开发者向的常量块"**（整个块都放行）。
   *
   * -> 比如 `DEFAULT_MESSAGES = { ... }` 里的每一行都放行
   * -> 不用逐条判断（那个会漏）
   */
  const developerBlocks = [];
  for (const name of DEVELOPER_FACING_OBJECTS) {
    const idx = code.indexOf(`const ${name}`);
    if (idx < 0) {
      continue;
    }
    const end = code.indexOf('};', idx);
    developerBlocks.push([idx, end > 0 ? end : code.length]);
  }

  cjkLiteralRe.lastIndex = 0;
  let m = cjkLiteralRe.exec(code);
  while (m !== null) {
    const value = m[2] ?? '';
    // 含有中文 -> 硬编码
    if (value && /[一-鿿]/.test(value)) {
      const context = code.slice(Math.max(0, m.index - 100), m.index + 80);
      const lineNo = code.slice(0, m.index).split('\n').length;
      const lineText = code.split('\n')[lineNo - 1] ?? '';
      const inDeveloperBlock = developerBlocks.some(
        ([start, end]) => m.index >= start && m.index <= end,
      );
      if (!inDeveloperBlock && !isAllowedHere(rel, context, lineText)) {
        problems.push(`${rel}:${lineNo}  硬编码中文 -> ${m[0].slice(0, 90)}`);
      }
    }
    m = cjkLiteralRe.exec(code);
  }
}

// ————————————————————————————————————————————
// ② 文案表完整性（**交叉校验**）
// ————————————————————————————————————————————

const msgSrc = readFileSync(join(SRC, 'i18n/messages.ts'), 'utf8');

/** 取一张表里的 key（`key: '...'` 的形式） */
function keysOf(tableName) {
  const m = msgSrc.match(new RegExp(`const ${tableName}[^=]*= \\{([\\s\\S]*?)\\n\\};`));
  if (!m) {
    return null;
  }
  return [...m[1].matchAll(/^\s{2}'([^']+)':/gm)].map((x) => x[1]);
}

/** `Messages` interface 的 key */
const ifaceKeys = [
  ...(msgSrc.match(/export interface Messages \{([\s\S]*?)\n\}/)?.[1] ?? '').matchAll(
    /^\s{2}'([^']+)':/gm,
  ),
].map((x) => x[1]);

const zhKeys = keysOf('ZH_MESSAGES');
const enKeys = keysOf('EN_MESSAGES');

/** 内置语言表（ja / fr）在 builtin-defaults.ts 里 */
const builtinSrc = readFileSync(join(SRC, 'core/config/builtin-defaults.ts'), 'utf8');
function builtinKeys(locale) {
  // ⚠️ 内置表的缩进是 2 空格（`  ja: {`），key 是 4 空格
  const m = builtinSrc.match(new RegExp(`^  ${locale}: \\{([\\s\\S]*?)^  },`, 'm'));
  if (!m) {
    return null;
  }
  return [...m[1].matchAll(/^ {4}'([^']+)':/gm)].map((x) => x[1]);
}

const tables = [
  ['Messages interface', ifaceKeys],
  ['ZH_MESSAGES', zhKeys],
  ['EN_MESSAGES', enKeys],
  ['BUILTIN_LOCALES.ja', builtinKeys('ja')],
  ['BUILTIN_LOCALES.fr', builtinKeys('fr')],
];

for (const [name, keys] of tables) {
  if (!keys) {
    problems.push(`文案表 ${name} 没找到`);
    continue;
  }
  const set = new Set(keys);
  const missing = ifaceKeys.filter((k) => !set.has(k));
  if (missing.length > 0) {
    problems.push(
      `文案表 ${name} 缺少 ${missing.length} 个 key -> ${missing.slice(0, 8).join(', ')}`,
    );
  }
}

// ————————————————————————————————————————————
// ③ 工具栏占位符必须在 Messages 里
// ————————————————————————————————————————————

const toolbarSrc = readFileSync(join(SRC, 'core/editor/rich-text.ts'), 'utf8');
const placeholders = [...toolbarSrc.matchAll(/label:\s*'\{([^']+)\}'/g)].map((m) => m[1]);
const ifaceSet = new Set(ifaceKeys);
for (const p of placeholders) {
  if (!ifaceSet.has(p)) {
    problems.push(`工具栏占位符 {${p}} 不在 Messages 里`);
  }
}

// ————————————————————————————————————————————
// 输出
// ————————————————————————————————————————————

console.log(`文案 key 总数：${ifaceKeys.length}`);
console.log('内置语言：zh / en / ja / fr');
console.log(`工具栏占位符：${placeholders.length} 个`);

if (problems.length > 0) {
  console.error(`\n❌ 发现 ${problems.length} 个问题：\n`);
  for (const p of problems) {
    console.error(`  ${p}`);
  }
  process.exitCode = 1;
} else {
  console.log(' 没有发现问题');
}
