/*
 * @Author: hidari
 * @Date: 2026-10-30 15:38:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:38:15
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { VERSION } from "@scholar-club/pdf-viewer";
import * as core from "@scholar-club/pdf-viewer/core";

/**
 * Phase 0 demo —— 证明三条消费契约（<PdfViewer> 组件阶段 2 才来）：
 * 1. 主入口可 import（VERSION）
 * 2. ./core 子路径可 import（当前空模块，契约全是类型）
 * 3. ./styles.css 生效（下面的色块用的是包的 CSS 变量）
 * 全程零 antd：原生元素 + 包的 CSS 变量。
 */
export default function App() {
  return (
    <div className="scpdf-root" style={{ minHeight: "100vh", padding: 24 }}>
      <h1 style={{ fontSize: 18 }}>@scholar-club/pdf-viewer demo</h1>
      <ul style={{ fontSize: 14, lineHeight: 2 }}>
        <li>main 入口 import OK，VERSION = {VERSION}</li>
        <li>
          core 子路径 import OK，运行时导出 = [{Object.keys(core).join(", ")}]
          （当前全类型，空模块属预期）
        </li>
        <li>
          styles.css 生效，primary 色 ={" "}
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              background: "var(--scpdf-color-primary)",
              verticalAlign: "middle",
            }}
          />{" "}
          <code>var(--scpdf-color-primary)</code>
        </li>
        <li>零 antd：本页面全部为原生元素 + 包 CSS 变量</li>
      </ul>
      <p style={{ fontSize: 12, opacity: 0.6 }}>渲染 / 选区 / 高亮 / 交互：阶段 1–2</p>
    </div>
  );
}
