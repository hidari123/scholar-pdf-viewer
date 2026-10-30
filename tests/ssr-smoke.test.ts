/*
 * @Author: hidari
 * @Date: 2026-10-30 14:21:21
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:38:57
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

  it("pdfjs-dist 可在 Node 环境直接 import（import 无副作用）", async () => {
    const pdfjs = await import("pdfjs-dist");
    expect(typeof pdfjs.getDocument).toBe("function");
  });

  it("idb 可在 Node 环境直接 import（openDB 调用前不碰 IndexedDB）", async () => {
    const idb = await import("idb");
    expect(typeof idb.openDB).toBe("function");
  });

  it("core 子路径入口可在 Node 环境直接 import", async () => {
    const core = await import("../src/core");
    expect(core).toBeTypeOf("object");
  });
});
