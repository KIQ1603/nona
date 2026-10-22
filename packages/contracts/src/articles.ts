import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Articles ("Bài viết"): posts written by staff. The body is a small, safe Markdown subset that the
// browser and the API both understand through the same pure parser (no raw HTML is ever accepted).
// ---------------------------------------------------------------------------------------------

export const ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'Bản nháp',
  PUBLISHED: 'Đã đăng',
  ARCHIVED: 'Đã lưu trữ',
};

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang');
const text = (max: number) => z.string().trim().max(max);

export const createArticleSchema = z
  .object({
    title: z.string().trim().min(1, 'Hãy nhập tiêu đề').max(160),
    slug: slug.optional(),
    excerpt: text(400).default(''),
    body: z.string().max(60_000).default(''),
    coverAlt: text(200).default(''),
    seoTitle: text(160).nullable().optional(),
    seoDescription: text(300).nullable().optional(),
  })
  .strict();
export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export const updateArticleSchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(160).optional(),
    slug: slug.optional(),
    excerpt: text(400).optional(),
    body: z.string().max(60_000).optional(),
    coverAlt: text(200).optional(),
    seoTitle: text(160).nullable().optional(),
    seoDescription: text(300).nullable().optional(),
    status: z.enum(ARTICLE_STATUSES).optional(),
  })
  .strict();
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

export const articleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(24).default(9),
});
export const adminArticleListQuerySchema = z.object({
  status: z.enum(ARTICLE_STATUSES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const cover = z.object({
  url: z.string(),
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});

export const articleSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  cover: cover.nullable(),
  publishedAt: z.string(),
  authorName: z.string().nullable(),
});
export type ArticleSummary = z.infer<typeof articleSummarySchema>;

export const articleSchema = articleSummarySchema.extend({
  body: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  updatedAt: z.string(),
});
export type ArticleDto = z.infer<typeof articleSchema>;

export const articleListSchema = z.object({
  items: z.array(articleSummarySchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

export const adminArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  cover: cover.nullable(),
  authorName: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  publishedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Why the article cannot be published yet (empty when it can). */
  publishIssues: z.array(z.string()),
});
export type AdminArticle = z.infer<typeof adminArticleSchema>;

export const adminArticleListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      status: z.enum(ARTICLE_STATUSES),
      coverUrl: z.string().nullable(),
      publishedAt: z.string().nullable(),
      updatedAt: z.string(),
      authorName: z.string().nullable(),
    }),
  ),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

export const articleImageSchema = z.object({
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});

/** What must be true before an article may go public. Pure; used by API and admin UI. */
export function articlePublishIssues(a: {
  title: string;
  body: string;
  hasCover: boolean;
}): string[] {
  const issues: string[] = [];
  if (!a.title.trim()) issues.push('Cần có tiêu đề');
  if (!a.body.trim()) issues.push('Cần có nội dung');
  if (!a.hasCover) issues.push('Cần có ảnh bìa');
  return issues;
}

// ---- body parser -------------------------------------------------------------------------------

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };
export type Block =
  | { t: 'heading'; level: 2 | 3; children: Inline[] }
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'quote'; children: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'rule' };

/** Only these link targets are ever rendered as links: https, mailto, tel and same-site paths. */
export const isSafeLink = (href: string) =>
  /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[+0-9][0-9\s.-]{5,20}|\/(?!\/)[^\s<>"']*)$/i.test(
    href,
  );
/** Images may come from http(s) or same-site paths; never data:/javascript:. */
export const isSafeImage = (src: string) =>
  /^(https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*)$/i.test(src);

function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', text: buf });
    buf = '';
  };
  while (i < input.length) {
    const rest = input.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\*\*([^*]+?)\*\*/.exec(rest))) {
      flush();
      out.push({ t: 'bold', children: parseInline(m[1]!) });
      i += m[0].length;
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush();
      out.push({ t: 'italic', children: parseInline(m[1]!) });
      i += m[0].length;
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      if (isSafeLink(m[2]!)) {
        flush();
        out.push({ t: 'link', href: m[2]!, children: parseInline(m[1]!) });
      } else buf += m[1]; // an unsafe target degrades to its plain text
      i += m[0].length;
    } else {
      buf += input[i];
      i++;
    }
  }
  flush();
  return out;
}

/** Parses the safe Markdown subset: ## / ### headings, paragraphs, - / 1. lists, > quotes, ![alt](src), ---. */
export function parseArticleBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'paragraph', children: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!line) {
      flushPara();
      flushList();
    } else if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({
        t: 'heading',
        level: m[1]!.length === 2 ? 2 : 3,
        children: parseInline(m[2]!),
      });
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ t: 'rule' });
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line))) {
      flushPara();
      flushList();
      if (isSafeImage(m[2]!)) blocks.push({ t: 'image', src: m[2]!, alt: m[1]! });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({ t: 'quote', children: parseInline(m[1]!) });
    } else if ((m = /^([-*]|\d+\.)\s+(.+)$/.exec(line))) {
      flushPara();
      const ordered = /\d/.test(m[1]!);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(m[2]!));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of a body, used for the reading-time estimate and fallback descriptions. */
export function articlePlainText(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const readingMinutes = (body: string) =>
  Math.max(1, Math.round(articlePlainText(body).split(' ').filter(Boolean).length / 200));
