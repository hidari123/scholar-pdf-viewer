import { describe, expect, it } from 'vitest';
import type { LinkAnnotationLike } from './links';
import { hitTestLink, isSafeUrl, linkToViewRect, normalizeLinks } from './links';

/** A4 页面（pt） */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** 造一个链接注解 */
function link(overrides: Partial<LinkAnnotationLike> = {}): LinkAnnotationLike {
  return {
    subtype: 'Link',
    rect: [72, 700, 200, 720],
    url: 'https://example.com',
    ...overrides,
  };
}

describe('isSafeUrl', () => {
  it('允许常见协议', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeUrl('tel:+123')).toBe(true);
  });

  it('拒绝 javascript:（XSS）', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('拒绝 data: 协议', () => {
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
  });

  it('允许相对链接', () => {
    expect(isSafeUrl('/path/to/page')).toBe(true);
    expect(isSafeUrl('./relative')).toBe(true);
  });

  it('拒绝空串', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});

describe('normalizeLinks', () => {
  it('归一化坐标（0-1）', () => {
    const links = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);

    expect(links).toHaveLength(1);
    expect(links[0]?.rect.x1).toBeCloseTo(72 / PAGE_WIDTH);
    expect(links[0]?.rect.x2).toBeCloseTo(200 / PAGE_WIDTH);
  });

  it('y 轴翻转（PDF 顶部 → 归一化 0）', () => {
    const links = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);

    // PDF y=720（顶部）→ 归一化 y1 ≈ 1 - 720/842
    expect(links[0]?.rect.y1).toBeCloseTo(1 - 720 / PAGE_HEIGHT);
    expect(links[0]?.rect.y2).toBeCloseTo(1 - 700 / PAGE_HEIGHT);
  });

  it('保留外部 URL', () => {
    const links = normalizeLinks([link({ url: 'https://a.com' })], PAGE_WIDTH, PAGE_HEIGHT);

    expect(links[0]?.url).toBe('https://a.com');
  });

  it('不安全的 URL 被丢弃（链接整体不生成）', () => {
    const links = normalizeLinks([link({ url: 'javascript:alert(1)' })], PAGE_WIDTH, PAGE_HEIGHT);

    expect(links).toHaveLength(0);
  });

  it('内部跳转保留 dest', () => {
    const links = normalizeLinks(
      [link({ url: undefined, dest: [3, '/XYZ'] })],
      PAGE_WIDTH,
      PAGE_HEIGHT,
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBeNull();
    expect(links[0]?.dest).toEqual([3, '/XYZ']);
  });

  it('既无 url 也无 dest → 丢弃', () => {
    const links = normalizeLinks([link({ url: undefined, dest: null })], PAGE_WIDTH, PAGE_HEIGHT);

    expect(links).toHaveLength(0);
  });

  it('空列表 → 空结果', () => {
    expect(normalizeLinks([], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
    expect(normalizeLinks(undefined, PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it('矩形不合法 → 丢弃', () => {
    expect(normalizeLinks([link({ rect: [] })], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it('id 唯一', () => {
    const links = normalizeLinks([link(), link(), link()], PAGE_WIDTH, PAGE_HEIGHT);

    const ids = new Set(links.map((l) => l.id));
    expect(ids.size).toBe(3);
  });
});

describe('hitTestLink', () => {
  it('点在链接内 → 命中', () => {
    const [normalized] = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);
    if (!normalized) {
      throw new Error('链接未生成');
    }

    expect(hitTestLink(normalized, 0.2, 0.16)).toBe(true);
  });

  it('点在链接外 → 不命中', () => {
    const [normalized] = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);
    if (!normalized) {
      throw new Error('链接未生成');
    }

    expect(hitTestLink(normalized, 0.9, 0.9)).toBe(false);
  });

  it('边界算命中', () => {
    const [normalized] = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);
    if (!normalized) {
      throw new Error('链接未生成');
    }

    expect(hitTestLink(normalized, normalized.rect.x1, normalized.rect.y1)).toBe(true);
  });
});

describe('linkToViewRect', () => {
  it('换算成视口像素', () => {
    const [normalized] = normalizeLinks([link()], PAGE_WIDTH, PAGE_HEIGHT);
    if (!normalized) {
      throw new Error('链接未生成');
    }
    const rect = linkToViewRect(normalized, 1190, 1684);

    expect(rect.left).toBeCloseTo((72 / PAGE_WIDTH) * 1190);
    expect(rect.width).toBeCloseTo(((200 - 72) / PAGE_WIDTH) * 1190);
  });
});
