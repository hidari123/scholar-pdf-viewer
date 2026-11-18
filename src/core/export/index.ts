/**
 * export 层 —— 导出（带高亮的 PDF）。
 *
 * ⚠️ **pdf-lib 是可选依赖**（optional peerDependency）
 * → 不用导出的宿主：这段代码不会被打包进去（0 体积）
 * → 用导出的宿主：`npm i pdf-lib`
 */

export * from './export-pdf';
