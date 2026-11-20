import { readFileSync } from 'node:fs';

const pdf = readFileSync('src/components/PdfViewer.tsx', 'utf8');
const props = pdf.match(/export interface PdfViewerProps \{([\s\S]*?)\n\}/)[1];
// 逐个 prop 提取 "名字? : 类型"
const lines = props.split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {2}([a-zA-Z][\w]*)\??:\s*(.+);$/);
  if (m) {
    let type = m[2];
    // 类型跨行 -> 继续往后拼
    let j = i + 1;
    while (!type.includes(';') && j < lines.length && j < i + 6) {
      type += ` ${lines[j].trim()}`;
      j++;
    }
    out.push(`${m[1]}${lines[i].includes('?') ? '?' : ''}: ${type.replace(/;$/, '').trim()}`);
  }
}
console.log(out.join('\n'));
