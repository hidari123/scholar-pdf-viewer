/**
 * 启动 demo（**固定端口 5180**）。
 *
 * ## 为什么有这个脚本
 *
 * 之前每次起 demo 的端口都不一样（5180 → 5181 → 5200 → 5201 …），
 * 原因有两个：
 * 1. `vite.config.ts` 没配 `server.port` → Vite 自动挑端口
 * 2. 端口被占用时 Vite 会**偷偷往后找一个** → 地址变得不可预测
 *
 * → 现在：
 * - `demo/vite.config.ts` 里 `port: 5180` + `strictPort: true`
 * - 端口被占用 → **直接报错**（不会偷偷换）
 *
 * ## 用法
 *
 * ```sh
 * pnpm demo          # 启动（前台）
 * pnpm demo:build    # 构建包 + 构建 demo 静态站
 * ```
 *
 * ⚠️ demo 消费的是**包的 `dist/`** → 改了包源码必须先 `pnpm build`，
 *    然后**重启** demo（Vite 会缓存 workspace 依赖）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_PORT = 5180;
const DEMO_URL = `http://127.0.0.1:${DEMO_PORT}`;

console.log(`[demo] 固定端口 ${DEMO_PORT} → ${DEMO_URL}`);
console.log('[demo] 停止服务：Ctrl+C');
console.log('');

/*
 * ⚠️ **先构建包**（demo 消费的是 `dist/`）。
 *
 * 不构建的话，如果 `dist/` 不存在或过期，demo 会白屏 / 报
 * "Failed to resolve import @scholar-club/pdf-viewer/styles.css"。
 *
 * → 每次起 demo 都保证 `dist/` 是最新的。
 */
console.log('[demo] 构建包（dist/）…');
const build = spawnSync('pnpm', ['build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  console.error('[demo] 构建失败 → 退出');
  process.exit(build.status ?? 1);
}
console.log('[demo] 构建完成');
console.log('');

const child = spawn('pnpm', ['--filter', '@scholar-club/pdf-viewer-demo', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error('');
    console.error(`[demo] 退出码 ${code}`);
    if (code === 1) {
      console.error(`[demo] 端口 ${DEMO_PORT} 可能被占用 → 先关掉旧进程（见 README「启动」章节）`);
    }
  }
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill();
    process.exit(0);
  });
}

// 便于脚本判断"服务是否起来了"
if (existsSync(join(root, 'demo', 'index.html'))) {
  console.log(`[demo] 打开 ${DEMO_URL}`);
}
