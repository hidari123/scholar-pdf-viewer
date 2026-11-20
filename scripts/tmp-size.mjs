import { readFileSync } from 'node:fs';

const src = readFileSync('src/components/PdfViewer.tsx', 'utf8');
const lines = src.split('\n');
console.log('总行数:', lines.length);
// 统计顶层声明
const decls = [];
lines.forEach((l, i) => {
  const m = l.match(/^(export )?(function|const|interface|type|class)\s+([A-Za-z0-9_]+)/);
  if (m) decls.push({ line: i + 1, kind: m[2], name: m[3] });
});
console.log('\n=== 顶层声明 ===');
for (const d of decls) console.log(`${String(d.line).padStart(5)}  ${d.kind.padEnd(10)} ${d.name}`);
console.log('\n=== useCallback / useMemo / useEffect 数量 ===');
for (const hook of ['useCallback', 'useMemo', 'useEffect', 'useState', 'useRef']) {
  const n = (src.match(new RegExp(`\\b${hook}\\(`, 'g')) || []).length;
  console.log(`${hook}: ${n}`);
}
