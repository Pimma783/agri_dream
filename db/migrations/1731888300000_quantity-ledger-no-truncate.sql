-- Up Migration
-- quantity_ledger had only a row-level BEFORE UPDATE OR DELETE trigger, so TRUNCATE emptied it.
-- Same protection as audit_logs: a statement-level BEFORE TRUNCATE trigger plus no TRUNCATE privilege.
CREATE TRIGGER quantity_ledger_no_truncate BEFORE TRUNCATE ON quantity_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION quantity_ledger_append_only();

REVOKE TRUNCATE ON quantity_ledger FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrimatch_app') THEN
    REVOKE TRUNCATE ON quantity_ledger FROM agrimatch_app;
  END IF;
END $$;

-- Down Migration

DROP TRIGGER quantity_ledger_no_truncate ON quantity_ledger;
