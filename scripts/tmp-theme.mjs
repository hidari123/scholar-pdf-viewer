import { readFileSync } from 'node:fs';

const theme = readFileSync('src/core/theme/index.ts', 'utf8');
// appearance 字段
const app = theme.match(/export interface PdfViewerAppearance \{([\s\S]*?)\n\}/)[1];
console.log('=== PdfViewerAppearance ===');
for (const m of app.matchAll(/^\s{2}(\w+)\??:\s*([^;]+);/gm))
  console.log(`  ${m[1]}${app.includes(`${m[1]}?`) ? '?' : ''}: ${m[2]}`);
console.log('\n=== PdfViewerSlots ===');
const slots = theme.match(/export interface PdfViewerSlots \{([\s\S]*?)\n\}/)[1];
for (const m of slots.matchAll(/^\s{2}(\w+)\??:\s*([^;]+);/gm)) console.log(`  ${m[1]}: ${m[2]}`);
