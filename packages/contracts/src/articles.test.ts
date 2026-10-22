import { describe, expect, it } from 'vitest';
import {
  articlePublishIssues,
  createArticleSchema,
  parseArticleBody,
  readingMinutes,
  updateArticleSchema,
  type Block,
} from './articles';

const text = (b: Block) => JSON.stringify(b);

describe('parseArticleBody', () => {
  it('parses headings, paragraphs, lists, quotes, rules and images', () => {
    const blocks = parseArticleBody(
      [
        '## Tiêu đề',
        '',
        'Đoạn một',
        'nối dòng.',
        '',
        '- a',
        '- b',
        '',
        '1. x',
        '2. y',
        '',
        '> trích dẫn',
        '',
        '---',
        '',
        '![Nón](https://cdn.example.com/a.webp)',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.t)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'rule',
      'image',
    ]);
    expect(blocks[1]).toMatchObject({
      t: 'paragraph',
      children: [{ t: 'text', text: 'Đoạn một nối dòng.' }],
    });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });
  it('supports bold, italic and safe links inside text', () => {
    const [p] = parseArticleBody(
      'Xem **đậm**, *nghiêng* và [trang chủ](/) hoặc [web](https://example.com).',
    );
    expect(p).toMatchObject({ t: 'paragraph' });
    const kinds = (p as Extract<Block, { t: 'paragraph' }>).children.map((c) => c.t);
    expect(kinds).toEqual([
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'link',
      'text',
      'link',
      'text',
    ]);
  });
  it('never produces a dangerous link or image: they degrade to text or disappear', () => {
    const blocks = parseArticleBody(
      [
        '[x](javascript:alert(1))',
        '',
        '[y](data:text/html;base64,AAAA)',
        '',
        '![z](javascript:alert(1))',
        '',
        '![w](data:image/svg+xml;base64,AAAA)',
        '',
        '[p](//evil.example/a)',
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
    );
    const out = blocks.map(text).join('');
    expect(out).not.toMatch(/javascript:|data:|\/\/evil/);
    expect(blocks.some((b) => b.t === 'image')).toBe(false);
    // raw HTML is plain text (the renderer escapes text nodes)
    expect(out).toContain('<script>alert(1)</script>');
  });
  it('estimates reading time', () => {
    expect(readingMinutes('một hai ba')).toBe(1);
    expect(readingMinutes(Array(900).fill('từ').join(' '))).toBe(5);
  });
});

describe('article schemas', () => {
  it('requires a title, normalises slugs and rejects unknown fields', () => {
    expect(createArticleSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createArticleSchema.parse({ title: 'Nón lá', slug: 'Non-La' }).slug).toBe('non-la');
    expect(createArticleSchema.safeParse({ title: 'x', slug: 'bad slug!' }).success).toBe(false);
    expect(createArticleSchema.safeParse({ title: 'x', status: 'PUBLISHED' }).success).toBe(false);
    expect(updateArticleSchema.safeParse({ version: 1, surprise: 1 }).success).toBe(false);
    expect(updateArticleSchema.safeParse({ version: 0 }).success).toBe(false);
  });
  it('lists what blocks publishing', () => {
    expect(articlePublishIssues({ title: '', body: '', hasCover: false })).toHaveLength(3);
    expect(articlePublishIssues({ title: 'a', body: 'b', hasCover: true })).toEqual([]);
  });
});
