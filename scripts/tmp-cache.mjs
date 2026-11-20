import { readFileSync } from 'node:fs';

const cache = readFileSync('src/core/cache/store.ts', 'utf8');
const m = cache.match(/export interface DocumentCache \{([\s\S]*?)\n\}/);
console.log('=== DocumentCache ===');
console.log(m ? m[1].trim() : '(没找到)');
console.log('\n=== 导出的函数 ===');
for (const x of cache.matchAll(/export (?:function|const|class) (\w+)/g)) console.log(`  ${x[1]}`);
console.log('\n=== cache 目录 ===');
