/**
 * E2E 的**统一基址**。
 *
 * ## 为什么要有这个文件
 *
 * 之前 17 个 E2E 脚本各自写了一个默认端口（5180 / 5181 / 5187 / 5190 / 5194 /
 * 5196 / 5198 / 5200 …）→ 每次跑 E2E 都要手动设 `E2E_BASE_URL`，
 * 否则一半脚本连不上。
 *
 * → 现在**所有脚本都用这一个常量**，默认端口固定 **5180**。
 *
 * ## 端口从哪来
 *
 * `demo/vite.config.ts` 里 `server.port = 5180` + `strictPort: true`
 * → Vite **不会**偷偷换端口（端口被占用时直接报错）。
 *
 * ⚠️ demo 消费的是**包的 `dist/`** → 改了包源码要：
 * ```
 * pnpm build        # 重新构建 dist
 * # 然后重启 demo 服务（Vite 会缓存 workspace 依赖）
 * ```
 */

/** 固定的 demo 端口 */
export const DEMO_PORT = 5180;

/** 统一的 E2E 基址 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${DEMO_PORT}`;
