-- Up Migration
-- One stored form for the three pilot provinces: the Thai name (same as the demo seed and the Dashboard).
-- Only the English spellings are rewritten; every other value is left as is. Safe to run twice (idempotent), no row is deleted.
CREATE OR REPLACE FUNCTION pg_temp.th_province(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(v))
    WHEN 'uttaradit' THEN 'อุตรดิตถ์'
    WHEN 'nakhon sawan' THEN 'นครสวรรค์'
    WHEN 'kamphaeng phet' THEN 'กำแพงเพชร'
    ELSE v END
$$;
UPDATE organizations SET province = pg_temp.th_province(province) WHERE province IS DISTINCT FROM pg_temp.th_province(province);
UPDATE material_listings SET province = pg_temp.th_province(province) WHERE province IS DISTINCT FROM pg_temp.th_province(province);
UPDATE purchase_demands SET province = pg_temp.th_province(province) WHERE province IS DISTINCT FROM pg_temp.th_province(province);
UPDATE baling_services SET province = pg_temp.th_province(province) WHERE province IS DISTINCT FROM pg_temp.th_province(province);
UPDATE baling_requests SET province = pg_temp.th_province(province) WHERE province IS DISTINCT FROM pg_temp.th_province(province);
UPDATE purchase_demands SET accepted_provinces = ARRAY(SELECT pg_temp.th_province(x) FROM unnest(accepted_provinces) WITH ORDINALITY AS t(x, i) ORDER BY i)
  WHERE accepted_provinces IS DISTINCT FROM ARRAY(SELECT pg_temp.th_province(x) FROM unnest(accepted_provinces) WITH ORDINALITY AS t(x, i) ORDER BY i);
UPDATE baling_services SET service_provinces = ARRAY(SELECT pg_temp.th_province(x) FROM unnest(service_provinces) WITH ORDINALITY AS t(x, i) ORDER BY i)
  WHERE service_provinces IS DISTINCT FROM ARRAY(SELECT pg_temp.th_province(x) FROM unnest(service_provinces) WITH ORDINALITY AS t(x, i) ORDER BY i);
UPDATE drafts SET data = jsonb_set(data, '{province}', to_jsonb(pg_temp.th_province(data->>'province')))
  WHERE jsonb_typeof(data->'province') = 'string' AND data->>'province' IS DISTINCT FROM pg_temp.th_province(data->>'province');
-- Down Migration
-- Not reversible on purpose: the previous mixed spellings are not recorded. Nothing to undo for readers (both forms still match).
SELECT 1;
