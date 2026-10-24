-- Sign-in with an external identity provider (Google). One identity per provider per account.
-- A Google sign-in never links to an existing password account: if the email is already registered
-- with a password, it is refused (the owner must sign in with the password).
CREATE TABLE user_identities (
  provider   text NOT NULL,
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  CONSTRAINT user_identities_provider_valid CHECK (provider IN ('google'))
);
CREATE UNIQUE INDEX user_identities_user_provider_uq ON user_identities (user_id, provider);
