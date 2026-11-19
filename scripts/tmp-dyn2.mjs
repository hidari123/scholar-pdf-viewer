import { readFileSync } from 'node:fs';

const s = readFileSync('dist/index.js', 'utf8');
// 找静态 import
const m = [...s.matchAll(/from\s*["']([^"']+)["']/g)].map((x) => x[1]);
console.log('静态 import:', [...new Set(m)].join(', '));
const c = readFileSync('dist/chunk-UA23TPA3.js', 'utf8');
console.log('chunk-UA23TPA3 含 AnnotationPanel:', c.includes('AnnotationPanel'));
console.log('chunk-UA23TPA3 含 RichText:', c.includes('RichText'));
