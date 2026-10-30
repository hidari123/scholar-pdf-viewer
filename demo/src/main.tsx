/*
 * @Author: hidari
 * @Date: 2026-10-30 15:37:52
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 16:28:17
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// 样式契约：包不注入样式，消费者自己 import（或 CDN link）
import '@scholar-club/pdf-viewer/styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
