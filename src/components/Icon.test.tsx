// @vitest-environment jsdom

/**
 * `components/Icon` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> 之前 \`Icon\` 里是 \`const label = title ?? name;\` ❌
 *   -> 生成的 DOM：\`<svg aria-hidden="true"><title>highlight</title>...</svg>\` ❌
 *   -> **同一个按钮里有两个 title** ❌
 *     -> 按钮的 \`title\` 是宿主传的中文
 *     -> SVG 的 \`title\` 是**英文图标名** ❌
 *   -> 浏览器/AT/扩展**可能取 SVG 的那个** -> 悬浮显示英文 ❌
 *
 * -> ⚠️ **更糟的是它会"跳来跳去"**（用户反馈：
 *   "语言他自己会动来动去的 有时候第一次悬浮上去显示中文 鼠标移开再上去就英文了"）
 *   -> 图标几何数据是**懒加载**的 -> 没加载完时**整个 SVG 都不渲染** ❌
 *   -> 于是 DOM 里**一会儿有 \`<title>\`、一会儿没有** -> tooltip 来源在两个值之间切 ❌
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';

describe('Icon', () => {
  it('**没传 title -> 不渲染 SVG 的 <title>**（审计修复）', async () => {
    const { container } = render(<Icon name="highlight" />);

    // 等懒加载完成
    await new Promise((r) => setTimeout(r, 50));

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // ⚠️ 关键断言：**没有 <title>**
    expect(svg?.querySelector('title')).toBeNull();
  });

  it('**没传 title -> DOM 里不含图标名**（不是"highlight"）', async () => {
    const { container } = render(<Icon name="highlight" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).not.toContain('<title>highlight</title>');
  });

  it('**传了 title -> 用它**（本地化后的文案）', async () => {
    const { container } = render(<Icon name="highlight" title="添加高亮" />);
    await new Promise((r) => setTimeout(r, 50));

    const title = container.querySelector('svg title');
    expect(title?.textContent).toBe('添加高亮');
  });

  it('**传了 title -> 整个 SVG 的内容都换语言了**', async () => {
    const { container: zh } = render(<Icon name="highlight" title="添加高亮" />);
    const { container: en } = render(<Icon name="highlight" title="Add highlight" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(zh.querySelector('svg title')?.textContent).toBe('添加高亮');
    expect(en.querySelector('svg title')?.textContent).toBe('Add highlight');
  });

  it('**宿主覆盖的图标 -> 不走内置渲染**（没有 SVG <title> 问题）', async () => {
    const { container } = render(
      <Icon name="highlight" title="添加高亮" overrides={{ highlight: <span>★</span> }} />,
    );

    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('★');
  });

  it('**SVG 始终是 aria-hidden**（无障碍：图标不重复朗读）', async () => {
    const { container } = render(<Icon name="highlight" title="添加高亮" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
