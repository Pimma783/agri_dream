-- Up Migration
-- In-app notifications for Dashboard organizations (task 23.1). One row per organization and new match pair.
-- supply_id and demand_id carry no foreign key: the matched entity may later be closed or removed, and a
-- notification must stay readable. The unique key makes a repeated recompute (or a pair that disappears and
-- returns) notify at most once.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('NEW_MATCH')),
  route smallint NOT NULL CHECK (route BETWEEN 1 AND 4),
  supply_id uuid NOT NULL,
  demand_id uuid NOT NULL,
  title_th text NOT NULL CHECK (length(title_th) > 0),
  body_th text NOT NULL,
  link_path text NOT NULL CHECK (link_path LIKE '/%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (org_id, kind, supply_id, demand_id)
);
CREATE INDEX notifications_org_created_idx ON notifications (org_id, created_at DESC, id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrimatch_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO agrimatch_app;
  END IF;
END $$;

-- Down Migration
DROP TABLE notifications;
