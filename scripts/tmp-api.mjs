import { readFileSync } from 'node:fs';

// ① PdfViewerProps 的完整清单
const pdf = readFileSync('src/components/PdfViewer.tsx', 'utf8');
const props = pdf.match(/export interface PdfViewerProps \{([\s\S]*?)\n\}/)[1];
const propNames = [...props.matchAll(/^\s{2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]);
console.log(`=== PdfViewerProps (${propNames.length} 个) ===`);
console.log(propNames.join('\n'));

// ② handle
const handle = pdf.match(/export interface PdfViewerHandle \{([\s\S]*?)\n\}/)[1];
const handleNames = [...handle.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]);
console.log(`\n=== PdfViewerHandle (${handleNames.length} 个) ===`);
console.log(handleNames.join(', '));

// ③ IconName
const icons = readFileSync('src/core/icons/icons.ts', 'utf8');
const iconUnion = icons.match(/export type IconName =([\s\S]*?);/)[1];
const iconNames = [...iconUnion.matchAll(/'([^']+)'/g)].map((m) => m[1]);
console.log(`\n=== IconName (${iconNames.length} 个) ===`);
console.log(iconNames.join(', '));

// ④ Messages 的 key
const msg = readFileSync('src/i18n/messages.ts', 'utf8');
const iface = msg.match(/export interface Messages \{([\s\S]*?)\n\}/)[1];
const keys = [...iface.matchAll(/'([^']+)':/g)].map((m) => m[1]);
console.log(`\n=== Messages (${keys.length} 个) ===`);
console.log(keys.join(', '));
