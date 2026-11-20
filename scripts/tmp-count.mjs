import { readFileSync } from 'node:fs';

// IconName 到底多少个
const icons = readFileSync('src/core/icons/icons.ts', 'utf8');
const union = icons.match(/export type IconName =([\s\S]*?);/)[1];
const list = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
console.log('IconName 实际数量:', list.length);
// 去掉注释里的
const cleaned = union.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const list2 = [...cleaned.matchAll(/'([^']+)'/g)].map((m) => m[1]);
console.log('去掉注释后:', list2.length);
console.log(list2.join(', '));

// Messages 多少个
const msg = readFileSync('src/i18n/messages.ts', 'utf8');
const zh = msg.match(/const ZH_MESSAGES[\s\S]*?= \{([\s\S]*?)\n\};/);
if (zh) {
  const keys = [...zh[1].matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]);
  console.log('\nZH_MESSAGES 实际 key 数:', keys.length);
}
