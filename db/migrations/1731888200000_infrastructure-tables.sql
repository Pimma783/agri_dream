-- Up Migration
-- Infrastructure tables (task 4.3): webhook_events, jobs, notification_outbox, audit_logs.
-- conversations, messages and idempotency_keys already exist in 1731888100000_business-tables.
-- webhook_events -------------------------------------------------------------------------------
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('farmer','baler','factory')),
  event_id text NOT NULL CHECK (length(event_id) > 0),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, event_id) -- dedup key (Requirement 2.5)
);

-- jobs -----------------------------------------------------------------------------------------
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (length(kind) > 0),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','RETRY','DONE','DEAD')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts <= max_attempts)
);
CREATE INDEX jobs_claim_idx ON jobs (run_at) WHERE status IN ('QUEUED','RETRY','RUNNING');

-- notification_outbox --------------------------------------------------------------------------
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('farmer','baler','factory')),
  to_line_identity_id uuid NOT NULL REFERENCES line_identities(id),
  message jsonb NOT NULL,
  retry_key uuid NOT NULL DEFAULT gen_random_uuid(), -- X-Line-Retry-Key, stable across retries
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','RETRY','DEAD')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text,
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) > 0), -- Requirement 15.5
  related_type text,
  related_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK ((related_type IS NULL) = (related_id IS NULL)),
  CHECK ((status = 'SENT') = (sent_at IS NOT NULL))
);
CREATE INDEX notification_outbox_claim_idx ON notification_outbox (next_attempt_at)
  WHERE status IN ('PENDING','RETRY','SENDING');
CREATE INDEX notification_outbox_identity_idx ON notification_outbox (to_line_identity_id);

-- audit_logs (append-only) ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid, -- no FK: the log must survive any later change to users
  actor_org_id uuid,
  channel text CHECK (channel IN ('web','line','assistant','system')),
  action text NOT NULL CHECK (length(action) > 0),
  entity_type text NOT NULL,
  entity_id uuid,
  entity_version int,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_org_idx ON audit_logs (actor_org_id, created_at);

CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

-- Privileges: nobody except the table owner (who is still stopped by the triggers) may change rows.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrimatch_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM agrimatch_app;
  END IF;
END $$;

-- Down Migration
DROP TRIGGER audit_logs_no_truncate ON audit_logs;
DROP TRIGGER audit_logs_no_update_delete ON audit_logs;
DROP TABLE audit_logs;
DROP FUNCTION audit_logs_append_only();
DROP TABLE notification_outbox;
DROP TABLE jobs;
DROP TABLE webhook_events;
