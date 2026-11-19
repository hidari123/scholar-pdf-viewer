import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
  .sort((a, b) => b.v - a.v);
let exe;
for (const d of dirs) {
  const e = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
  if (existsSync(e)) {
    exe = e;
    break;
  }
}

mkdirSync(join(process.cwd(), '.tmp-icons'), { recursive: true });

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });

const names = [
  'upload',
  'download',
  'copy',
  'translate',
  'highlight',
  'highlightColor',
  'comment',
  'trash',
  'more',
  'stickyNote',
  'note',
  'search',
  'print',
  'exportJson',
  'exportPdf',
  'file',
];

await page.setContent(`
<html><body style="margin:0;padding:20px;background:#fff;font-family:system-ui">
<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:14px">
${names
  .map(
    (n) => `<div style="text-align:center">
      <div id="i-${n}" style="display:inline-block;padding:8px;border:1px solid #eee;border-radius:8px;color:#2f6feb"></div>
      <div style="font-size:10px;color:#888;margin-top:4px">${n}</div>
    </div>`,
  )
  .join('')}
</div>
</body></html>
`);

// 从包导入图标数据
const svgHtml = await page.evaluate(async (names) => {
  const mod = await import('/@fs/C:/work/scholar-pdf-viewer/dist/index.js');
  const out = {};
  for (const n of names) {
    const shape = mod.getIconShape(n);
    if (!shape) {
      out[n] = '';
      continue;
    }
    const parts = [];
    for (const d of shape.fills ?? [])
      parts.push(`<path d="${d}" fill="currentColor" stroke="none"/>`);
    for (const d of shape.paths ?? []) parts.push(`<path d="${d}"/>`);
    for (const c of shape.circles ?? [])
      parts.push(`<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`);
    for (const r of shape.rects ?? [])
      parts.push(
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.rx ?? 0}"/>`,
      );
    for (const l of shape.lines ?? [])
      parts.push(`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`);
    for (const p of shape.polylines ?? []) parts.push(`<polyline points="${p.points}"/>`);
    out[n] =
      `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`;
  }
  return out;
}, names);

for (const [name, html] of Object.entries(svgHtml)) {
  if (html) {
    await page.evaluate(
      ({ id, html }) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
      },
      { id: `i-${name}`, html },
    );
  }
}

await page.waitForTimeout(400);
await page.screenshot({ path: join(process.cwd(), '.tmp-icons', 'preview.png') });
console.log('截图已保存');

await browser.close();
