import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
console.log('=== exports ===');
console.log(JSON.stringify(pkg.exports, null, 2));
console.log('\n=== files ===');
console.log(JSON.stringify(pkg.files));
console.log('\n=== scripts ===');
console.log(Object.keys(pkg.scripts).join(', '));
