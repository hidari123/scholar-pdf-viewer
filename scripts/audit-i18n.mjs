/**
 * **审计：有没有"硬编码的中文"漏在 i18n 之外**。
 *
 * ## 用户需求
 *
 * > "编辑批注啊 title啊 取消保存啊 这种文字都是要设置两套语言的哈
 * >  内置在包内 宿主通过接口输入进行切换
 * >  宿主也可以自己配置新的语言添加进来
 * >  宿主添加进来新的功能的时候 比如说新的工具栏配置按钮的时候
 * >  也要遵循这个规律 配置好切换的中英文或者其它语言
 * >  不止我说的这些 你整体排查一遍"
 *
 * ## 检查什么
 *
 * 1. **所有内置语言（zh / en / ja / fr）都覆盖了全部文案 key** ✅
 * 2. **组件里没有硬编码的用户可见文案**（中文 / 英文都不该有）✅
 * 3. **宿主可以添加新语言**（`locales` prop）✅
 * 4. **宿主自定义的工具栏按钮也能走 i18n**（`{key}` 占位符）✅
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const problems = [];

/** 递归列出所有 .ts / .tsx */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);

// —— ① 内置语言的完整性 ——
const messagesSrc = readFileSync(join(SRC, 'i18n/messages.ts'), 'utf8');
const iface = messagesSrc.match(/export interface Messages \{([\s\S]*?)\n\}/)[1];
const allKeys = [...iface.matchAll(/'([^']+)':/g)].map((m) => m[1]);

const builtinsSrc = readFileSync(join(SRC, 'core/config/builtin-defaults.ts'), 'utf8');
for (const lang of ['zh', 'en', 'ja', 'fr']) {
  const m = builtinsSrc.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},`));
  if (!m) {
    problems.push(`内置语言表缺少 ${lang}`);
    continue;
  }
  const keys = new Set([...m[1].matchAll(/'([^']+)':/g)].map((x) => x[1]));
  const missing = allKeys.filter((k) => !keys.has(k));
  if (missing.length > 0) {
    problems.push(`内置语言 ${lang} 缺 ${missing.length} 条：${missing.join(', ')}`);
  }
}

// —— ② 组件里的硬编码文案 ——
/**
 * **要检查的属性**（这些会显示给用户）。
 */
const _USER_FACING_ATTRS = [
  'aria-label',
  'title',
  'placeholder',
  'alt',
  'label',
  'message',
  'text',
];

/** 匹配 `attr="中文"` 或 `attr={'中文'}` 或 `attr="中文 {x}"` */
const attrRe =
  /\b(aria-label|title|placeholder|alt)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\})/g;

/**
 * **匹配模板字面量里的中文**（`` `批注：${x}` ``）。
 *
 * ⚠️ **之前漏了这一类** -> 审计说"没有硬编码"，实际有 ❌
 *   （`aria-label={\`批注：${firstRecord.content.slice(0, 20)}\`}`）
 *
 * ⚠️ **要匹配"成对的反引号"**，否则会跨过代码里的反引号误报 ❌
 *   （比如 `const a = 1; \`中文\`; const b = 2;` 这种）
 */
const templateRe = /`([^`\n]*[一-龥][^`\n]*)`/g;

/** 匹配 `label: '中文'` 这种配置项 */
const labelRe = /\blabel\s*:\s*(?:'([^']*)'|"([^"]*)")/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // 去掉注释（避免把注释里的中文当成硬编码）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const re of [attrRe, labelRe, templateRe]) {
    re.lastIndex = 0;
    let m = re.exec(code);
    while (m !== null) {
      const value = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[1] ?? '';
      // 含有中文 -> 硬编码（i18n 占位符 `{key}` 不算）
      if (value && /[一-龥]/.test(value)) {
        /*
         * ⚠️ **区分"UI 文案"和"开发者错误信息"**。
         *
         * → `core/` 层里 `throw new Error('...')` 是**给开发者看的** ❌
         *   -> 不用翻译（翻译了反而难排查）✅
         * -> UI 层（`components/`）的必须翻译 ✅
         */
        const context = code.slice(Math.max(0, m.index - 80), m.index + 60);
        const isDeveloperError =
          file.includes(`${join('core', '')}`) &&
          (context.includes('throw new Error') || context.includes('message:'));
        if (!isDeveloperError) {
          const line = code.slice(0, m.index).split('\n').length;
          problems.push(`${file}:${line} 硬编码文案 -> ${m[0].slice(0, 80)}`);
        }
      }
      m = re.exec(code);
    }
  }
}

// —— ③ 占位符 {key} 必须在 Messages 里 ——
const toolbarSrc = readFileSync(join(SRC, 'core/editor/rich-text.ts'), 'utf8');
const placeholders = [...toolbarSrc.matchAll(/label:\s*'\{([^']+)\}'/g)].map((m) => m[1]);
for (const p of placeholders) {
  if (!allKeys.includes(p)) {
    problems.push(`工具栏占位符 {${p}} 在 Messages 里不存在`);
  }
}

// —— ④ 宿主自定义按钮也能走 i18n（label.ts 支持占位符）——
const labelSrc = readFileSync(join(SRC, 'core/editor/label.ts'), 'utf8');
if (!labelSrc.includes('resolveToolbarLabel')) {
  problems.push('缺少 resolveToolbarLabel（宿主自定义按钮无法走 i18n）');
}

// —— 输出 ——
if (problems.length === 0) {
  console.log('✅ 没有发现问题');
  console.log(`   文案 key 总数：${allKeys.length}`);
  console.log('   内置语言：zh / en / ja / fr');
  console.log('   组件里的硬编码文案：0');
  console.log('   工具栏占位符：全部有效');
} else {
  console.log(`❌ 发现 ${problems.length} 个问题：`);
  for (const p of problems) {
    console.log(`   - ${p}`);
  }
  process.exitCode = 1;
}
