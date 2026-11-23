/**
 * **文字方向**（LTR / RTL）。
 *
 * ## 为什么需要这个文件（审计发现的）
 *
 * -> 之前**完全没有 RTL 支持** ❌
 *   -> 阿拉伯语 / 希伯来语的宿主**没法用** ❌
 *   -> 界面还是从左往右 ❌
 *   -> **上一页 / 下一页的箭头方向也是反的** ❌（在 RTL 里"下一页"应该朝左）
 *
 * ## 怎么判断方向
 *
 * ```
 * 1. 宿主显式传 `dir`        -> 用它（最高优先级）
 * 2. `locale` 是 RTL 语言    -> 'rtl'
 * 3. `document.dir === 'rtl'` -> 'rtl'
 * 4. 都没有                  -> 'ltr'
 * ```
 *
 * ⚠️ **纯函数**（零 DOM 依赖）-> 可以在 `core` 层直接测 ✅
 */

/** 文字方向 */
export type Direction = 'ltr' | 'rtl';

/**
 * **RTL 语言**（BCP 47 的语言标签前缀）。
 *
 * ⚠️ **只列"一定是 RTL"的**：
 * -> 阿拉伯语 `ar` / 希伯来语 `he` / 波斯语 `fa` / 乌尔都语 `ur` ✅
 * -> `az`（阿塞拜疆语）、`pa`（旁遮普语）**默认是 LTR** ❌ -> 不列 ✅
 */
const RTL_LANGUAGES = new Set([
  'ar', // 阿拉伯语
  'arc', // 亚兰语
  'dv', // 迪维希语
  'fa', // 波斯语
  'ha', // 豪萨语
  'he', // 希伯来语
  'khw', // 科瓦特语
  'ks', // 克什米尔语
  'ps', // 普什图语
  'sd', // 信德语
  'ur', // 乌尔都语
  'yi', // 意第绪语
]);

/**
 * **这个 locale 是不是 RTL？**
 *
 * @param locale 语言标签（如 `'ar'` / `'ar-EG'` / `'zh-CN'`）
 * @returns 是 RTL 则 true
 */
export function isRtlLocale(locale: string | undefined): boolean {
  if (!locale) {
    return false;
  }
  // ⚠️ **取语言子标签**：`'ar-EG'` -> `'ar'`（BCP 47 的写法）
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGES.has(language);
}

/**
 * **算出最终的方向**。
 *
 * @param explicit 宿主显式传的 `dir`
 * @param locale 当前语言
 * @param documentDir 宿主页面上的 `document.dir`（SSR 时传 `undefined`）
 * @returns 最终方向
 */
export function resolveDirection(
  explicit: Direction | undefined,
  locale: string | undefined,
  documentDir?: string,
): Direction {
  // 1) 宿主显式传 -> 最高优先级
  if (explicit === 'rtl' || explicit === 'ltr') {
    return explicit;
  }
  // 2) locale 是 RTL 语言 -> rtl
  if (isRtlLocale(locale)) {
    return 'rtl';
  }
  /*
   * 3) **locale 明确是 LTR 语言** -> 保持 ltr
   *
   * ⚠️ **这里很容易想反**（实测踩到的）：
   * -> 宿主页面 \`dir="rtl"\`（阿拉伯语站点），但组件 \`locale="en"\` ❌
   *   -> 如果按页面的 \`dir\` 走 -> **英文按钮全反了** ❌
   *   -> 组件的语言**是显式选的** -> 应该**跟着语言走** ✅
   */
  if (locale) {
    return 'ltr';
  }
  // 4) 没有 locale -> 看宿主页面的 dir
  if (documentDir === 'rtl') {
    return 'rtl';
  }
  // 5) 兜底
  return 'ltr';
}
