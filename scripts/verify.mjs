import { spawnSync } from 'node:child_process';

/**
 * verify = 质量门禁总入口：按顺序跑所有 gate，任一红即停止并以非零码退出。
 *
 * 设计原则：
 * - 门禁清单单一事实源：本地提交前与 CI 跑同一个脚本，
 *   增删门禁 = 只改这一个文件，"本地绿 = CI 绿"结构上成立
 * - 每个 gate 是单条 pnpm 命令，零 shell 拼接（无 && / ;），
 *   任何 OS / 任何 shell 行为一致（第 7 步 && 教训）
 * - 顺序有含义：build 必须先于 demo:typecheck（demo 消费 dist），
 *   也必须先于 size/publint/attw（它们检查 dist）
 */
const gates = [
  { name: 'lint', args: ['run', 'lint'] },
  { name: 'typecheck', args: ['run', 'typecheck'] },
  { name: 'test', args: ['run', 'test'] },
  { name: 'build', args: ['run', 'build'] },
  { name: 'demo:typecheck', args: ['-C', 'demo', 'run', 'typecheck'] },
  // 发布门禁：包体积 / package.json 规范 / 类型解析
  { name: 'size', args: ['run', 'size'] },
  { name: 'publint', args: ['run', 'publint'] },
  { name: 'attw', args: ['run', 'attw'] },
];

for (const gate of gates) {
  console.log(`\n[verify] ▶ ${gate.name}`);
  const result = spawnSync('pnpm', gate.args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n[verify] ✗ ${gate.name} 失败 (exit ${result.status})，后续 gate 不再执行`);
    process.exit(result.status ?? 1);
  }
  console.log(`[verify] ✓ ${gate.name}`);
}

console.log(
  '\n[verify] ✓ 全绿：lint + typecheck + test + build + demo typecheck + size + publint + attw',
);
