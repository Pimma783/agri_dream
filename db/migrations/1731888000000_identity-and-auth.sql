-- Up Migration
-- Identity and auth tables (task 4.1). Secrets are stored only as sha256 hex hashes.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('FARMER','BALER','BUYER_FACTORY')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  province text,
  district text,
  lat numeric(9,6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(9,6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE,
  password_hash text,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  consent_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- a password without an email could never be used to log in
  CHECK (password_hash IS NULL OR email IS NOT NULL)
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  member_role text NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('OWNER','MEMBER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX memberships_org_id_idx ON memberships (org_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  active_org_id uuid REFERENCES organizations(id),
  csrf_secret text NOT NULL CHECK (length(csrf_secret) >= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE line_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('farmer','baler','factory')),
  line_provider_id text,
  line_user_id text NOT NULL CHECK (length(line_user_id) > 0),
  user_id uuid REFERENCES users(id),
  org_id uuid REFERENCES organizations(id),
  status text NOT NULL CHECK (status IN ('UNLINKED','LINKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, line_user_id),
  CHECK ((status = 'LINKED') = (org_id IS NOT NULL AND user_id IS NOT NULL))
);
CREATE INDEX line_identities_org_id_idx ON line_identities (org_id);
CREATE INDEX line_identities_user_id_idx ON line_identities (user_id);

CREATE TABLE line_link_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  channel text NOT NULL CHECK (channel IN ('farmer','baler','factory')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX line_link_codes_user_id_idx ON line_link_codes (user_id);

-- Down Migration

DROP TABLE line_link_codes;
DROP TABLE line_identities;
DROP TABLE sessions;
DROP TABLE memberships;
DROP TABLE users;
DROP TABLE organizations;
-- the citext extension is left installed; later migrations may depend on it
