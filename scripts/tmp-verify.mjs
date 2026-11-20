import { existsSync, readFileSync } from 'node:fs';

const check = (label, cond, extra = '') =>
  console.log(`${cond ? 'OK  ' : 'WRONG'} ${label}${extra ? ` -> ${extra}` : ''}`);

// 1) core 里有没有 createDocumentCache
const coreIdx = readFileSync('src/core/index.ts', 'utf8');
check('core 导出 createDocumentCache', /createDocumentCache/.test(coreIdx));
check(
  'core 导出 sanitizeRichText',
  /export \* from '\.\/editor/.test(coreIdx) || existsSync('src/core/editor/index.ts'),
);

// 2) 根导出有哪些
const rootIdx = readFileSync('src/index.ts', 'utf8');
console.log('\n=== src/index.ts ===');
console.log(
  rootIdx
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .join('\n'),
);

// 3) ToastController 的方法
const toast = readFileSync('src/components/Toast.tsx', 'utf8');
const m = toast.match(/interface ToastController \{([\s\S]*?)\n\}/);
if (m) {
  console.log('\n=== ToastController ===');
  console.log(m[1].trim());
} else console.log('\n(ToastController 没在 Toast.tsx)');
