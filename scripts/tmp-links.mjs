import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const files = ['README.md', 'docs/API.md', 'docs/GUIDE.md', 'docs/EXTENDING.md'];
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\]\((\.[^)#]+)(#[^)]*)?\)/g)) {
    const abs = resolve(dirname(f), m[1]);
    if (!existsSync(abs)) {
      console.log(`BROKEN ${f} -> ${m[1]}  (${abs})`);
      bad++;
    }
  }
}
console.log(bad === 0 ? 'OK 所有相对链接都有效' : `${bad} 个断链`);
