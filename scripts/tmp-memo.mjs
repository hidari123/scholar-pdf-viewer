import { readFileSync } from 'node:fs';

const files = [
  'Toolbar',
  'Page',
  'PageCanvas',
  'TextLayer',
  'AnnotationLayer',
  'LinkLayer',
  'StickyNoteLayer',
  'SelectionPopover',
  'OutlinePanel',
  'SearchPanel',
  'PasswordDialog',
  'ThumbnailPanel',
];
for (const f of files) {
  const p = `src/components/${f}.tsx`;
  let src;
  try {
    src = readFileSync(p, 'utf8');
  } catch {
    console.log(f.padEnd(20), '(没有这个文件)');
    continue;
  }
  const _memo = /export const \w+ = memo\(|export function \w+\(/.test(src) && /memo\(/.test(src);
  const isMemo = /memo\(/.test(src);
  const fc = (src.match(/function \w+\(/) || []).length;
  console.log(f.padEnd(20), isMemo ? 'memo ✅' : '未 memo ❌', '| 函数数:', fc);
}
