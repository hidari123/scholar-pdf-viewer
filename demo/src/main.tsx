/*
 * @Author: hidari
 * @Date: 2026-10-30 15:37:52
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:37:59
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// 样式契约：包不注入样式，消费者自己 import（或 CDN link）
import "@scholar-club/pdf-viewer/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
