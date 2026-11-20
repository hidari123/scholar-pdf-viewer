import { readFileSync } from 'node:fs';

const src = readFileSync('src/components/PdfViewer.tsx', 'utf8');
const lines = src.split('\n');

console.log('=== 1. useState 传函数（会被当 lazy initializer）===');
lines.forEach((l, i) => {
  if (/set[A-Z]\w*\(\s*\w+\s*\)/.test(l) && !/set[A-Z]\w*\(\(\)/.test(l)) {
    // 排除 setX(() => ...)
    const m = l.match(/set([A-Z]\w*)\(\s*([A-Za-z_$][\w$.]*)\s*\)/);
    if (m && !/set[A-Z]\w*\(\(/.test(l)) {
      const name = m[2];
      // 检查这个变量是不是函数定义
      const isFn = new RegExp(`(const|function)\\s+${name.replace(/\./g, '\\.')}\\s*(=|\\()`).test(
        src,
      );
      if (isFn) console.log(`  ${i + 1}: ${l.trim().slice(0, 90)}`);
    }
  }
});

console.log('\n=== 2. useEffect 依赖里的对象字面量 ===');
lines.forEach((l, i) => {
  if (/\}, \[/.test(l)) {
    const dep = l.match(/\}, \[([^\]]*)\]/);
    if (dep && /\{/.test(dep[1])) console.log(`  ${i + 1}: ${l.trim().slice(0, 90)}`);
  }
});

console.log('\n=== 3. 直接在 render 里创建对象/数组传给子组件 ===');
lines.forEach((l, i) => {
  if (/=\{\{/.test(l) || /=\{\[/.test(l)) {
    if (!/useMemo|useState|useRef|useCallback|style=/.test(l))
      console.log(`  ${i + 1}: ${l.trim().slice(0, 90)}`);
  }
});
