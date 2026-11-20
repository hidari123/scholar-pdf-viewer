import { readFileSync } from 'node:fs';

const cache = readFileSync('src/core/cache/store.ts', 'utf8');
const m = cache.match(/(?:export )?(?:interface|type) DocumentCache[\s\S]*?(?:\n\}|;)/);
console.log('=== DocumentCache 定义 ===');
console.log(m ? m[0] : '(没找到)');
const idx = readFileSync('src/core/cache/index.ts', 'utf8');
console.log('\n=== cache/index.ts ===');
console.log(idx.trim());
