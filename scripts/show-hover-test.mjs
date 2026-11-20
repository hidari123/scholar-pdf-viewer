import { readFileSync } from 'node:fs';

const s = readFileSync('scripts/e2e-annotation-hover.mjs', 'utf8');
const i = s.indexOf('点"编辑"');
console.log(s.slice(Math.max(0, i - 900), i + 900));
