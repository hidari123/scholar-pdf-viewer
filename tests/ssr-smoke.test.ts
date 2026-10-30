/*
 * @Author: hidari
 * @Date: 2026-10-30 14:21:21
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:21:28
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { describe, expect, it } from "vitest";

// SSR 冒烟：包的入口必须在纯 Node 环境（无 window/document/navigator）下可直接 import。
// 它守卫的是一整类 bug：模块顶层访问 DOM（如 navigator.userAgent 探测浏览器）。
describe("SSR smoke", () => {
  it("主入口可在 Node 环境直接 import（顶层无 DOM 访问）", async () => {
    const main = await import("../src/index");
    expect(main.VERSION).toBe("0.1.0");
  });
});
