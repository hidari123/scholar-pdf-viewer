import { readFileSync } from 'node:fs';

const chk = (label, ok, extra = '') =>
  console.log(`${ok ? 'OK  ' : 'WRONG'} ${label}${extra ? ` -> ${extra}` : ''}`);

// 1) onRequestPassword 最多 3 次
const doc = readFileSync('src/hooks/usePdfDocument.ts', 'utf8');
chk('密码最多 3 次尝试', /3\s*\/\/|attempt|MAX_\w*ATTEMPT/i.test(doc));

// 2) pageRefToNumber 同步优先
const pdf = readFileSync('src/components/PdfViewer.tsx', 'utf8');
chk('pageRefToNumber 同步优先于 resolvePageRef', /pageRefToNumber/.test(pdf));

// 3) SelectionAction 的 disabled 字段
const act = readFileSync('src/core/selection/actions.ts', 'utf8');
chk('SelectionAction 有 disabled 字段', /disabled\?:/.test(act));
chk('SelectionAction 有 group 字段', /group\?:/.test(act));

// 4) ToastController 的 clear
const toast = readFileSync('src/components/Toast.tsx', 'utf8');
chk('ToastController 有 clear()', /clear:/.test(toast));

// 5) AnnotationRecord 的字段
const ann = readFileSync('src/core/annotation/sticky-note.ts', 'utf8');
const m = ann.match(/export interface AnnotationRecord \{([\s\S]*?)\n\}/);
console.log('\n=== AnnotationRecord ===');
console.log(m ? m[1].trim() : '(没找到)');

// 6) HighlightRecord 的字段
const hl = readFileSync('src/core/types.ts', 'utf8');
const m2 = hl.match(/export interface HighlightRecord \{([\s\S]*?)\n\}/);
console.log('\n=== HighlightRecord ===');
console.log(m2 ? m2[1].trim() : '(没找到)');

// 7) NewHighlight
const m3 = hl.match(/export interface NewHighlight \{([\s\S]*?)\n\}/);
console.log('\n=== NewHighlight ===');
console.log(m3 ? m3[1].trim() : '(没找到)');
