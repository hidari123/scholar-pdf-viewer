/**
 * **pdf.js 的静态资源路径**（标准字体 / CMap / WASM）。
 *
 * ## 为什么需要这个（用户反馈的"页面刚打开顶部出现乱码"）
 *
 * ### 症状
 *
 * 首次打开页面时，PDF 页面**中间**的文字挤成一团、位置全乱，
 * 但页眉、标题、作者列表这些地方是**正常**的。刷新一下就好了。
 *
 * ### 根因
 *
 * pdf.js 用 `g_d0_fN` 这样的名字给文档里的每种字体建 `@font-face`。
 * **PDF 里内嵌了的字体**它能直接拿到字节，但**没内嵌的**
 * 要去 `standardFontDataUrl` 指的目录下载对应的 `.pfb`。
 *
 * 不配这个目录 -> pdf.js **请求不到任何 .pfb** ->
 * 那些字体全部 fallback 到系统字体 -> **字宽度不对** ->
 * canvas 上按字宽度排的文字**位置全错** -> 就是看到的"乱码"。
 *
 * 实测（不配的时候）：
 *
 * ```
 * pdf.js 发出的请求: 只有 1 条（worker）-> 没请求 standard_fonts/
 * g_d0_f1: 16.28  <- 和 sans-serif 完全一样（没有自己的字体数据）
 * g_d0_f5: 13.82  <- 有自己的数据（PDF 内嵌了）
 * ```
 *
 * 23 个字体里 20 个没有数据 -> 那些页就画歪了。
 *
 * ### 为什么"刷新就没"
 *
 * pdf.js 是**渐进渲染**的：一边下载字体一边画。
 * 字体到位之前画的那几页是歪的，到位之后画的是对的。
 * 刷新后时序不同（或命中缓存）-> 看起来就正常了。
 *
 * ### 修法
 *
 * 给 `getDocument` 配上 `standardFontDataUrl` / `cMapUrl` / `wasmUrl`。
 * 路径用 `new URL(..., import.meta.url)` 算 —— 打包器能静态分析到，
 * 产物里会带上这些资源。
 *
 * ### 宿主可以覆盖
 *
 * 宿主有自己的字体子集 / 自己的 CMap 目录 ->
 * 传 `pdfJsResourcePaths` 覆盖 ✅（浅覆盖 ✅ -> 只写要改的那几个 ✅）。
 */

/** pdf.js 静态资源的路径（**每项都可以省略**） */
export interface PdfJsResourcePaths {
  /**
   * **标准字体目录**（14 个标准字体的 `.pfb`）。
   *
   * -> 不配的话 -> 文档里**没内嵌**字体的页会画歪 ❌
   */
  standardFontDataUrl?: string;
  /**
   * **CMap 目录**（`.bcmap`）。
   *
   * -> 只影响**中日韩竖排**和**带 Identity-H 编码**的 PDF ✅
   * -> 体积大（169 个文件 / 1.1 MB）✅ -> 默认**不内置** ✅
   */
  cMapUrl?: string;
  /**
   * **WASM 目录**（`jbig2.wasm` / `openjpeg.wasm` / `qcms_bg.wasm`）。
   *
   * -> 只影响**JBIG2 图像 / JPEG2000 图像 / 色彩空间转换** ✅
   * -> 体积大（1.5 MB）✅ -> 默认**不内置** ✅
   */
  wasmUrl?: string;
}

/**
 * 算出 pdf.js 的静态资源路径。
 *
 * ⚠️ **宿主传了哪个就用哪个** ✅（浅覆盖 ✅）
 * -> 宿主只传 `cMapUrl` ✅ -> 标准字体还是用内置的 ✅
 *
 * @param overrides 宿主的覆盖（**浅覆盖** ✅）
 * @returns 完整的路径表（`undefined` 的项表示"没配" ✅）
 */
export function resolvePdfJsResourcePaths(overrides?: PdfJsResourcePaths): PdfJsResourcePaths {
  return {
    standardFontDataUrl: overrides?.standardFontDataUrl ?? builtinStandardFontDataUrl(),
    cMapUrl: overrides?.cMapUrl,
    wasmUrl: overrides?.wasmUrl,
  };
}

/**
 * 内置的**标准字体目录** URL。
 *
 * ⚠️ **打包器要能静态分析到** ✅
 * -> `new URL('pdfjs-dist/standard_fonts/', import.meta.url)` ✅
 * -> tsup / Vite / webpack 都会把这个目录拷进产物 ✅
 *
 * @returns 目录 URL（**取不到就返回 `undefined`** ✅）
 */
function builtinStandardFontDataUrl(): string | undefined {
  try {
    /*
     * ⚠️ **路径必须是 `./standard_fonts/`** ✅
     *
     * -> 产物里的 chunk 在 `dist/` 根下 ✅
     * -> `new URL('./standard_fonts/', import.meta.url)` ✅
     *    -> 解析成 `<产物目录>/standard_fonts/` ✅
     * -> 构建时把 `pdfjs-dist/standard_fonts` 拷到 `dist/standard_fonts` ✅
     *    -> **正好对上** ✅
     *
     * -> 不能写 `pdfjs-dist/standard_fonts/` ❌
     *    -> 会解析成 `<产物目录>/pdfjs-dist/standard_fonts/` ❌
     *    -> 那里什么都没有 ❌
     */
    /*
     * ⚠️⚠️ **必须自己补尾部斜杠**（实测踩到的坑 ✅）
     *
     * -> `new URL('./standard_fonts/', import.meta.url).href` ✅
     *    -> **结果没有尾部斜杠** ❌（`new URL` 会把目录形态的斜杠吃掉 ✅）
     *    -> `.../dist/standard_fonts` ✅
     * -> pdf.js 是**直接拼字符串**的 ✅
     *    -> `standardFontDataUrl + 'FoxitSans.pfb'` ✅
     *    -> 拼成 `.../standard_fontsFoxitSans.pfb` ❌ **404** ✅
     */
    const url = new URL('./standard_fonts/', import.meta.url).href;
    return url.endsWith('/') ? url : `${url}/`;
  } catch {
    /*
     * ⚠️ **老打包器不支持 `new URL(..., import.meta.url)`** ❌
     * -> 返回 `undefined` ✅ -> pdf.js 用它自己的默认逻辑 ✅
     * -> （不会出现"资源指向一个坏 URL" ✅）
     */
    return undefined;
  }
}
