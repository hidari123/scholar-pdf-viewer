import { readFileSync } from 'node:fs';

// ① SelectionPopover：高亮色 {key}
const sp = readFileSync('src/components/SelectionPopover.tsx', 'utf8');
console.log('=== SelectionPopover 的 props ===');
const m = sp.match(/export interface SelectionPopoverProps \{([\s\S]*?)\n\}/);
console.log(m ? m[1].slice(0, 1200) : '没找到');
console.log('=== t 的定义 ===');
const t2 = sp.match(/const t = useCallback[\s\S]{0,300}/);
console.log(t2 ? t2[0] : '没找到 t');
