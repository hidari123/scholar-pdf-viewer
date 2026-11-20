import { readFileSync } from 'node:fs';

const toast = readFileSync('src/components/Toast.tsx', 'utf8');
const m = toast.match(/ToastController[\s\S]{0,900}?\n\}/);
console.log('=== ToastController ===');
console.log(m ? m[0] : '(没找到)');
