/**
 * E2E 总入口 —— 依次跑所有 E2E 脚本，汇总结果。
 *
 * 用法：
 * ```sh
 * pnpm demo        # 先起 demo（固定端口 5180）
 * pnpm e2e:all     # 跑全部（默认 http://127.0.0.1:5180）
 * ```
 *
 * ⚠️ 跑之前必须：`pnpm build`（demo 消费 dist）+ 启动 demo。
 */

import { spawnSync } from 'node:child_process';
import { E2E_BASE_URL } from './e2e-base.mjs';

/** 所有 E2E 脚本 */
const suites = [
  { name: '冒烟（渲染/缩放/跳页）', file: 'e2e-smoke.mjs' },
  { name: '文本层', file: 'e2e-text-layer.mjs' },
  { name: '面板（缩略图/目录/搜索）', file: 'e2e-panels.mjs' },
  { name: '链接层', file: 'e2e-links.mjs' },
  { name: '选区精准度', file: 'e2e-selection-align.mjs' },
  { name: '选区稳定性', file: 'e2e-selection-stability.mjs' },
  { name: '选区浮层', file: 'e2e-selection-popover.mjs' },
  { name: '选区形状', file: 'e2e-selection-shape.mjs' },
  { name: '选区跨行回归', file: 'e2e-selection-regression.mjs' },
  { name: '浮层锚定回归', file: 'e2e-popover-anchor.mjs' },
  { name: '选区性能', file: 'e2e-selection-perf.mjs' },
  { name: '面板开合时的选区定位', file: 'e2e-panel-offset.mjs' },
  { name: '高亮后的清选区 + 操作条', file: 'e2e-highlight-popover.mjs' },
  { name: '切换文档时重置高亮/选区', file: 'e2e-document-switch.mjs' },
  { name: '打印效果', file: 'e2e-print.mjs' },
  { name: '主题与外观', file: 'e2e-themes.mjs' },
  { name: '侧栏开合时自动重适配', file: 'e2e-sidebar-fit.mjs' },
  { name: '多行选择的覆盖率', file: 'e2e-selection-coverage.mjs' },
  { name: '跨页选择', file: 'e2e-cross-page-selection.mjs' },
  { name: '导出带高亮的 PDF', file: 'e2e-export-pdf.mjs' },
  { name: '导出 PDF 的批注编码', file: 'e2e-export-pdf-encoding.mjs' },
  { name: '高亮浮层的 4 个按钮 + 小便签批注', file: 'e2e-highlight-actions4.mjs' },
  { name: '打印预览', file: 'e2e-print-preview.mjs' },
  { name: '插槽（方案 D）', file: 'e2e-slots.mjs' },
  { name: '高亮的持久化', file: 'e2e-highlight-persist.mjs' },
  { name: '缩放矩阵（选区/高亮/性能）', file: 'e2e-zoom-matrix.mjs' },
  { name: '高亮效果', file: 'e2e-highlight.mjs' },
  { name: '缩放行为', file: 'e2e-zoom.mjs' },
  { name: '搜索高亮', file: 'e2e-search-highlight.mjs' },
  { name: '搜索高亮的定位准确性', file: 'e2e-search-accuracy.mjs' },
  { name: '图标系统', file: 'e2e-icons.mjs' },
  { name: '多语言（宿主 JSON 添加语言）', file: 'e2e-i18n.mjs' },
  { name: '多批注分组 + 便利贴面板 + 富文本', file: 'e2e-annotation-panel.mjs' },
  { name: '加批注按钮 + 富文本弹窗', file: 'e2e-annotation-dialog.mjs' },
  { name: '统一配置对象', file: 'e2e-config.mjs' },
  { name: '搜索高亮（像素级精度）', file: 'e2e-search-exact.mjs' },
  { name: 'TipTap 富文本编辑器', file: 'e2e-tiptap.mjs' },
  { name: '编辑器的空格 + update 事件', file: 'e2e-editor-space.mjs' },
  { name: '工具栏的按下态 + 完整功能', file: 'e2e-editor-toolbar.mjs' },
  { name: '自定义链接弹窗（两行）', file: 'e2e-editor-link.mjs' },
  { name: 'UI 打磨（输入框 / 位置 / 高亮 / 语言 / hover）', file: 'e2e-ui-polish.mjs' },
  { name: '第 21 轮（链接弹窗 / 删除线 / 缩放 / 跳转）', file: 'e2e-round21.mjs' },
  { name: '键盘导航（翻页 / Home / End / 缩放）', file: 'e2e-keyboard.mjs' },
  { name: 'Ctrl + 滚轮缩放', file: 'e2e-wheel-zoom.mjs' },
  { name: 'RTL（从右往左）', file: 'e2e-rtl.mjs' },
  { name: '内置的语言和高亮色', file: 'e2e-builtin-defaults.mjs' },
  { name: '内置配置（色板 + 语言）可被宿主覆盖', file: 'e2e-builtin-config.mjs' },
  { name: '目录的异步页码解析', file: 'e2e-outline-resolve.mjs' },
  { name: '退格删高亮', file: 'e2e-highlight-delete-key.mjs' },
  { name: '批注 hover 的操作按钮 + 富文本预览', file: 'e2e-annotation-hover.mjs' },
  { name: '批注弹窗的定位 + 编辑器的样子', file: 'e2e-annotation-dialog-anchor.mjs' },
  { name: '富文本：文字颜色 + 清空格式', file: 'e2e-richtext-color.mjs' },
  {
    name: '富文本：深色字色 + 文字高亮 + 图标区分',
    file: 'e2e-richtext-text-highlight.mjs',
  },
  { name: '批注期间点到底下的高亮', file: 'e2e-annotation-highlight-under.mjs' },
  {
    name: '批注弹窗点击不误激活高亮',
    file: 'e2e-annotation-dialog-highlight-activate.mjs',
  },
  { name: '编辑批注（锚点弹窗 + 保存按钮）', file: 'e2e-annotation-edit.mjs' },
  { name: '便签详情（展开 + 只读 + 编辑切换）', file: 'e2e-annotation-detail.mjs' },
  { name: '合并组选择列表（渲染富文本 + 点项打开详情）', file: 'e2e-sticky-picker.mjs' },
  { name: '便签好 hover（热区 + 不移开就消失）', file: 'e2e-sticky-hover.mjs' },
  { name: '重复的高亮 id（只激活点到的那一个）', file: 'e2e-highlight-duplicate-id.mjs' },
  { name: '打印时藏起便签和浮层（不泄露批注）', file: 'e2e-print-hide-overlays.mjs' },
  { name: '打印时所有页都有内容（不是白页）', file: 'e2e-print-all-pages.mjs' },
  { name: '高亮按钮直接用当前色 / 默认色', file: 'e2e-highlight-default-color.mjs' },
  { name: '工具栏的主题选择按钮', file: 'e2e-theme-picker.mjs' },
  { name: '缩放比例可以填写', file: 'e2e-scale-input.mjs' },
  { name: '没选字时只有"清除格式"置灰', file: 'e2e-editor-disabled-state.mjs' },
  { name: '批注详情贴在便签旁边（任意页）', file: 'e2e-annotation-panel-position.mjs' },
  { name: '跨页选择高亮（两页都有）', file: 'e2e-cross-page-highlight.mjs' },
  { name: '选区浮层的 tooltip 本地化', file: 'e2e-i18n-titles.mjs' },
  { name: '缩略图', file: 'e2e-thumbnail.mjs' },
];

const baseUrl = E2E_BASE_URL;
console.log(`[e2e:all] 目标 ${baseUrl}\n`);

const summary = [];

/** 解析 "结果：N/M 通过" */
function parseResult(output) {
  const match = /结果：(\d+)\/(\d+) 通过/.exec(output);
  if (!match) {
    return null;
  }
  return { passed: Number(match[1]), total: Number(match[2]) };
}

for (const suite of suites) {
  console.log(`━━ ${suite.name} ━━`);

  const result = spawnSync('node', [`scripts/${suite.file}`], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, E2E_BASE_URL: baseUrl },
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  // 只打关键行（PASS/FAIL/结果），避免刷屏
  for (const line of output.split('\n')) {
    if (line.includes('PASS') || line.includes('FAIL') || line.includes('结果')) {
      console.log(`  ${line.trim()}`);
    }
  }

  const parsed = parseResult(output);
  summary.push({
    name: suite.name,
    passed: parsed?.passed ?? 0,
    total: parsed?.total ?? 0,
    ok: result.status === 0,
  });

  console.log('');
}

console.log('━━ 汇总 ━━');
let totalPassed = 0;
let totalTotal = 0;
let failed = 0;

for (const item of summary) {
  const mark = item.ok ? '✓' : '✗';
  console.log(`  ${mark} ${item.name}: ${item.passed}/${item.total}`);
  totalPassed += item.passed;
  totalTotal += item.total;
  if (!item.ok) {
    failed += 1;
  }
}

console.log(`\n合计 ${totalPassed}/${totalTotal} 项断言通过，${failed} 个套件失败`);

if (failed > 0) {
  process.exitCode = 1;
}
