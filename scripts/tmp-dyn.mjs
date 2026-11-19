import { readFileSync } from 'node:fs';

const s = readFileSync('dist/index.js', 'utf8');
const m = [...s.matchAll(/import\(["']([^"']+)["']\)/g)].map((x) => x[1]);
console.log('动态 import:', [...new Set(m)].join(', '));
