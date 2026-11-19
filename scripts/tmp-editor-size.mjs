import { readFileSync } from 'node:fs';

const s = readFileSync('dist/editor.js', 'utf8');
console.log('editor.js 大小:', (s.length / 1024).toFixed(1), 'kB');
console.log('含 ProseMirror?', s.includes('ProseMirror'));
console.log('含 tiptap 源码?', s.includes('is-editor-empty') || s.includes('parseHTML'));
const m = [...s.matchAll(/from\s*"\.\/(chunk-[^"]+\.js)"/g)].map((x) => x[1]);
console.log('静态 import:', [...new Set(m)].join(', ') || '（无）');
