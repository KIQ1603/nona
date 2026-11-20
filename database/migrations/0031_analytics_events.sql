-- 0031_analytics_events: first-party, anonymous storefront traffic (page and product views).
-- No IP address, user agent or account id is stored: visitor_id is a random id the browser generates for itself.
-- Rollback: DROP TABLE analytics_events;
CREATE TABLE analytics_events (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  visitor_id    text NOT NULL,
  kind          text NOT NULL,
  path          text NOT NULL,
  product_slug  text,
  referrer_host text,
  CONSTRAINT analytics_kind_valid CHECK (kind IN ('PAGE_VIEW', 'PRODUCT_VIEW')),
  CONSTRAINT analytics_visitor_len CHECK (char_length(visitor_id) BETWEEN 16 AND 64),
  CONSTRAINT analytics_path_len CHECK (char_length(path) BETWEEN 1 AND 300)
);
CREATE INDEX analytics_events_time_idx ON analytics_events (occurred_at DESC);
CREATE INDEX analytics_events_kind_time_idx ON analytics_events (kind, occurred_at DESC);
