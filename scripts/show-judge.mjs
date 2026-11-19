import { readFileSync } from 'node:fs';

const path = 'scripts/e2e-search-exact.mjs';
const src = readFileSync(path, 'utf8');

// 找判定块
const idx = src.indexOf('const dLeft = Math.abs(hr.left - real.left);');
if (idx < 0) throw new Error('没找到 dLeft');

console.log(src.slice(idx, idx + 1400));
