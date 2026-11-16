/**
 * E2E 总入口 —— 依次跑所有 E2E 脚本，汇总结果。
 *
 * 用法：
 * ```sh
 * pnpm e2e:all              # 默认 http://localhost:5181
 * E2E_BASE_URL=http://localhost:5191 pnpm e2e:all
 * ```
 *
 * ⚠️ 跑之前必须：`pnpm build`（demo 消费 dist）+ 启动 demo。
 */

import { spawnSync } from 'node:child_process';

/** 所有 E2E 脚本 */
const suites = [
  { name: '冒烟（渲染/缩放/跳页）', file: 'e2e-smoke.mjs' },
  { name: '文本层', file: 'e2e-text-layer.mjs' },
  { name: '面板（缩略图/目录/搜索）', file: 'e2e-panels.mjs' },
  { name: '链接层', file: 'e2e-links.mjs' },
  { name: '选区精准度', file: 'e2e-selection-align.mjs' },
  { name: '高亮效果', file: 'e2e-highlight.mjs' },
  { name: '缩放行为', file: 'e2e-zoom.mjs' },
  { name: '搜索高亮', file: 'e2e-search-highlight.mjs' },
  { name: '缩略图', file: 'e2e-thumbnail.mjs' },
];

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5181';
console.log(`[e2e:all] 目标 ${baseUrl}\n`);

const summary = [];

/** 解析 "结果：N/M 通过" */
function parseResult(output) {
  const match = /结果：(\d+)\/(\d+) 通过/.exec(output);
  if (!match) {
    return null;
  }
  return { passed: Number(match[1]), total: Number(match[2]) };
}

for (const suite of suites) {
  console.log(`━━ ${suite.name} ━━`);

  const result = spawnSync('node', [`scripts/${suite.file}`], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, E2E_BASE_URL: baseUrl },
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  // 只打关键行（PASS/FAIL/结果），避免刷屏
  for (const line of output.split('\n')) {
    if (line.includes('PASS') || line.includes('FAIL') || line.includes('结果')) {
      console.log(`  ${line.trim()}`);
    }
  }

  const parsed = parseResult(output);
  summary.push({
    name: suite.name,
    passed: parsed?.passed ?? 0,
    total: parsed?.total ?? 0,
    ok: result.status === 0,
  });

  console.log('');
}

console.log('━━ 汇总 ━━');
let totalPassed = 0;
let totalTotal = 0;
let failed = 0;

for (const item of summary) {
  const mark = item.ok ? '✓' : '✗';
  console.log(`  ${mark} ${item.name}: ${item.passed}/${item.total}`);
  totalPassed += item.passed;
  totalTotal += item.total;
  if (!item.ok) {
    failed += 1;
  }
}

console.log(`\n合计 ${totalPassed}/${totalTotal} 项断言通过，${failed} 个套件失败`);

if (failed > 0) {
  process.exitCode = 1;
}
