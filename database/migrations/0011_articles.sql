-- 0011_articles: staff-written posts ("Bài viết") with a cover image, safe Markdown-subset body, publish workflow.
-- Rollback: DROP TABLE articles;
CREATE TABLE articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,
  title           text NOT NULL,
  excerpt         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  cover_key       text,
  cover_alt       text NOT NULL DEFAULT '',
  cover_width     integer,
  cover_height    integer,
  status          text NOT NULL DEFAULT 'DRAFT',
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  seo_title       text,
  seo_description text,
  published_at    timestamptz,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_slug_key UNIQUE (slug),
  CONSTRAINT articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 120),
  CONSTRAINT articles_title_len CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT articles_excerpt_len CHECK (char_length(excerpt) <= 400),
  CONSTRAINT articles_body_len CHECK (char_length(body) <= 60000),
  CONSTRAINT articles_status_valid CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- a public article always has a publication date, a cover and content
  CONSTRAINT articles_published_complete CHECK (
    status <> 'PUBLISHED' OR (published_at IS NOT NULL AND cover_key IS NOT NULL AND body <> '')
  )
);
CREATE INDEX articles_public_idx ON articles (published_at DESC) WHERE status = 'PUBLISHED';
CREATE INDEX articles_status_idx ON articles (status, updated_at DESC);
