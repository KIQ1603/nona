-- OAuth tokens of external providers (Zalo OA). Zalo rotates the refresh token on every refresh, so the
-- latest pair has to be stored. Values are encrypted by the worker (AES-256-GCM); never log or select them elsewhere.
CREATE TABLE integration_tokens (
  provider           text PRIMARY KEY,
  access_token_enc   text NOT NULL,
  refresh_token_enc  text NOT NULL,
  expires_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
