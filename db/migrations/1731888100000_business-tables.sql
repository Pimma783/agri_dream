-- Up Migration
-- Business tables (task 4.2). Quantity numeric(14,3) kg, unit price numeric(12,4), totals numeric(14,2).
-- No float columns. Enums are text + CHECK. Images are stored in PostgreSQL by default (media.content).

-- drafts ---------------------------------------------------------------------------------------
CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('SALE_LISTING','RESALE_LISTING','PURCHASE_DEMAND','BALING_SERVICE','BALING_REQUEST')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','AWAITING_REVIEW','PUBLISHED','CANCELLED')),
  published_entity_type text CHECK (published_entity_type IN ('LISTING','DEMAND','BALING_SERVICE','BALING_REQUEST')),
  published_entity_id uuid,
  source_agreement_id uuid, -- FK added after agreements exists
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT draft_published_shape CHECK (
    (status = 'PUBLISHED') = (published_entity_type IS NOT NULL AND published_entity_id IS NOT NULL)),
  CONSTRAINT resale_draft_has_source CHECK (kind <> 'RESALE_LISTING' OR source_agreement_id IS NOT NULL)
);
CREATE INDEX drafts_org_id_idx ON drafts (org_id);

-- material_listings ----------------------------------------------------------------------------
CREATE TABLE material_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('SALE','RESALE')),
  material_type text NOT NULL CHECK (material_type IN ('RICE_STRAW','CANE_LEAF','CORN_COB','OTHER')),
  material_form text CHECK (material_form IN ('LOOSE','BALED')),
  total_qty_kg numeric(14,3) NOT NULL CHECK (total_qty_kg > 0),
  committed_qty_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (committed_qty_kg >= 0),
  remaining_qty_kg numeric(14,3) NOT NULL CHECK (remaining_qty_kg >= 0),
  price_mode text NOT NULL CHECK (price_mode IN ('FIXED','NEGOTIABLE')),
  unit_price_thb numeric(12,4) CHECK (unit_price_thb IS NULL OR unit_price_thb >= 0),
  price_unit text CHECK (price_unit IN ('KG','TON')),
  province text,
  district text,
  lat numeric(9,6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(9,6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  available_from timestamptz,
  available_to timestamptz,
  transport_by text NOT NULL DEFAULT 'UNKNOWN' CHECK (transport_by IN ('SELLER','BUYER','EITHER','UNKNOWN')),
  pending_material boolean NOT NULL DEFAULT false,
  expected_ready_at timestamptz,
  source_agreement_id uuid, -- FK added after agreements exists
  source_draft_id uuid UNIQUE REFERENCES drafts(id), -- publish idempotency
  status text NOT NULL CHECK (status IN ('PUBLISHED','PAUSED','CLOSED','CANCELLED')),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qty_balance CHECK (total_qty_kg = committed_qty_kg + remaining_qty_kg),
  -- NEGOTIABLE is stored as NULL price, never 0 (Requirement 6.5)
  CONSTRAINT price_shape CHECK (
    (price_mode = 'FIXED' AND unit_price_thb IS NOT NULL AND price_unit IS NOT NULL)
    OR (price_mode = 'NEGOTIABLE' AND unit_price_thb IS NULL)),
  CONSTRAINT resale_has_source CHECK (kind <> 'RESALE' OR source_agreement_id IS NOT NULL),
  CONSTRAINT pending_has_date CHECK (NOT pending_material OR expected_ready_at IS NOT NULL),
  CONSTRAINT listing_window CHECK (available_from IS NULL OR available_to IS NULL OR available_to >= available_from),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX material_listings_org_id_idx ON material_listings (org_id);
CREATE INDEX material_listings_match_idx ON material_listings (status, material_type);

-- purchase_demands -----------------------------------------------------------------------------
CREATE TABLE purchase_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  accepted_materials text[] NOT NULL CHECK (
    cardinality(accepted_materials) >= 1
    AND accepted_materials <@ ARRAY['RICE_STRAW','CANE_LEAF','CORN_COB','OTHER']::text[]),
  accepted_forms text[] NOT NULL DEFAULT ARRAY['LOOSE','BALED']::text[] CHECK (
    accepted_forms <@ ARRAY['LOOSE','BALED']::text[]),
  target_qty_kg numeric(14,3) NOT NULL CHECK (target_qty_kg > 0),
  committed_qty_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (committed_qty_kg >= 0),
  remaining_qty_kg numeric(14,3) NOT NULL CHECK (remaining_qty_kg >= 0),
  min_lot_kg numeric(14,3) CHECK (min_lot_kg IS NULL OR min_lot_kg > 0),
  price_mode text NOT NULL CHECK (price_mode IN ('FIXED','NEGOTIABLE')),
  max_unit_price_thb numeric(12,4) CHECK (max_unit_price_thb IS NULL OR max_unit_price_thb >= 0),
  price_unit text CHECK (price_unit IN ('KG','TON')),
  province text,
  district text,
  lat numeric(9,6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(9,6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  radius_km numeric(6,2) CHECK (radius_km IS NULL OR radius_km > 0),
  accepted_provinces text[] NOT NULL DEFAULT ARRAY[]::text[],
  window_from timestamptz,
  window_to timestamptz,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quality) = 'object'),
  transport_by text NOT NULL DEFAULT 'UNKNOWN' CHECK (transport_by IN ('SELLER','BUYER','EITHER','UNKNOWN')),
  accepts_pending_material boolean NOT NULL DEFAULT false,
  source_draft_id uuid UNIQUE REFERENCES drafts(id),
  status text NOT NULL CHECK (status IN ('PUBLISHED','PAUSED','CLOSED','CANCELLED')),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_qty_balance CHECK (target_qty_kg = committed_qty_kg + remaining_qty_kg),
  CONSTRAINT demand_price_shape CHECK (
    (price_mode = 'FIXED' AND max_unit_price_thb IS NOT NULL AND price_unit IS NOT NULL)
    OR (price_mode = 'NEGOTIABLE' AND max_unit_price_thb IS NULL)),
  CONSTRAINT demand_window CHECK (window_from IS NULL OR window_to IS NULL OR window_to >= window_from),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX purchase_demands_org_id_idx ON purchase_demands (org_id);
CREATE INDEX purchase_demands_status_idx ON purchase_demands (status);

-- baling_services and baling_requests ----------------------------------------------------------
CREATE TABLE baling_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  material_types text[] NOT NULL CHECK (
    cardinality(material_types) >= 1
    AND material_types <@ ARRAY['RICE_STRAW','CANE_LEAF','CORN_COB','OTHER']::text[]),
  baling_format text,
  service_mode text NOT NULL CHECK (service_mode IN ('ON_SITE','AT_FACTORY','BOTH')),
  service_provinces text[] NOT NULL DEFAULT ARRAY[]::text[],
  province text,
  district text,
  lat numeric(9,6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(9,6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  min_qty_kg numeric(14,3) CHECK (min_qty_kg IS NULL OR min_qty_kg > 0),
  capacity_kg numeric(14,3) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
  price_mode text NOT NULL CHECK (price_mode IN ('FIXED','NEGOTIABLE')),
  unit_price_thb numeric(12,4) CHECK (unit_price_thb IS NULL OR unit_price_thb >= 0),
  price_unit text CHECK (price_unit IN ('KG','TON','BALE')),
  transport_by text NOT NULL DEFAULT 'UNKNOWN' CHECK (transport_by IN ('SELLER','BUYER','EITHER','UNKNOWN')),
  available_from timestamptz,
  available_to timestamptz,
  source_draft_id uuid UNIQUE REFERENCES drafts(id),
  status text NOT NULL CHECK (status IN ('PUBLISHED','PAUSED','CLOSED','CANCELLED')),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_price_shape CHECK (
    (price_mode = 'FIXED' AND unit_price_thb IS NOT NULL AND price_unit IS NOT NULL)
    OR (price_mode = 'NEGOTIABLE' AND unit_price_thb IS NULL)),
  CONSTRAINT service_window CHECK (available_from IS NULL OR available_to IS NULL OR available_to >= available_from),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX baling_services_org_id_idx ON baling_services (org_id);
CREATE TABLE baling_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  material_type text NOT NULL CHECK (material_type IN ('RICE_STRAW','CANE_LEAF','CORN_COB','OTHER')),
  qty_kg numeric(14,3) NOT NULL CHECK (qty_kg > 0),
  requested_mode text NOT NULL CHECK (requested_mode IN ('ON_SITE','AT_FACTORY')),
  province text,
  district text,
  lat numeric(9,6) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric(9,6) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  needed_from timestamptz,
  needed_to timestamptz,
  source_draft_id uuid UNIQUE REFERENCES drafts(id),
  status text NOT NULL CHECK (status IN ('PUBLISHED','PAUSED','CLOSED','CANCELLED')),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_window CHECK (needed_from IS NULL OR needed_to IS NULL OR needed_to >= needed_from),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX baling_requests_org_id_idx ON baling_requests (org_id);

-- offers ---------------------------------------------------------------------------------------
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('PURCHASE','BALING_SERVICE')),
  from_org_id uuid NOT NULL REFERENCES organizations(id),
  to_org_id uuid NOT NULL REFERENCES organizations(id),
  listing_id uuid REFERENCES material_listings(id),
  demand_id uuid REFERENCES purchase_demands(id),
  baling_service_id uuid REFERENCES baling_services(id),
  baling_request_id uuid REFERENCES baling_requests(id),
  qty_kg numeric(14,3) NOT NULL CHECK (qty_kg > 0),
  unit_price_thb numeric(12,4) CHECK (unit_price_thb IS NULL OR unit_price_thb >= 0),
  price_unit text CHECK (price_unit IN ('KG','TON','BALE')),
  total_amount_thb numeric(14,2) CHECK (total_amount_thb IS NULL OR total_amount_thb >= 0),
  transport_by text NOT NULL CHECK (transport_by IN ('SELLER','BUYER','EITHER','UNKNOWN')),
  transport_cost_thb numeric(12,2) CHECK (transport_cost_thb IS NULL OR transport_cost_thb >= 0), -- never folded into total
  ready_date date,
  expires_at timestamptz NOT NULL,
  listing_version int,
  demand_version int,
  ack_pending_material boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN','EXPIRED')),
  supersedes_offer_id uuid REFERENCES offers(id),
  idempotency_key text,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_org_id, idempotency_key),
  CHECK (from_org_id <> to_org_id),
  CHECK ((kind = 'PURCHASE' AND listing_id IS NOT NULL AND demand_id IS NOT NULL)
      OR (kind = 'BALING_SERVICE' AND baling_service_id IS NOT NULL AND baling_request_id IS NOT NULL)),
  CHECK ((unit_price_thb IS NULL) = (price_unit IS NULL))
);
CREATE INDEX offers_from_org_idx ON offers (from_org_id);
CREATE INDEX offers_to_org_idx ON offers (to_org_id);
CREATE INDEX offers_listing_idx ON offers (listing_id);
CREATE INDEX offers_demand_idx ON offers (demand_id);
CREATE INDEX offers_pending_expiry_idx ON offers (expires_at) WHERE status = 'PENDING';

-- agreements -----------------------------------------------------------------------------------
CREATE TABLE agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('PURCHASE','BALING_SERVICE')),
  offer_id uuid NOT NULL UNIQUE REFERENCES offers(id), -- idempotent accept
  seller_org_id uuid NOT NULL REFERENCES organizations(id),
  buyer_org_id uuid NOT NULL REFERENCES organizations(id),
  listing_id uuid REFERENCES material_listings(id),
  demand_id uuid REFERENCES purchase_demands(id),
  baling_service_id uuid REFERENCES baling_services(id),
  baling_request_id uuid REFERENCES baling_requests(id),
  qty_kg numeric(14,3) NOT NULL CHECK (qty_kg > 0),
  unit_price_thb numeric(12,4) CHECK (unit_price_thb IS NULL OR unit_price_thb >= 0),
  price_unit text CHECK (price_unit IN ('KG','TON','BALE')),
  total_amount_thb numeric(14,2) CHECK (total_amount_thb IS NULL OR total_amount_thb >= 0),
  status text NOT NULL CHECK (status IN ('PURCHASE_CONFIRMED','SERVICE_CONFIRMED','NEEDS_REVIEW','CANCELLED')),
  resale_reserved_kg numeric(14,3) NOT NULL DEFAULT 0,
  source_agreement_id uuid REFERENCES agreements(id),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_demo boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resale_cap CHECK (resale_reserved_kg >= 0 AND resale_reserved_kg <= qty_kg),
  CONSTRAINT kind_status CHECK (
    (kind = 'PURCHASE' AND status IN ('PURCHASE_CONFIRMED','NEEDS_REVIEW','CANCELLED'))
    OR (kind = 'BALING_SERVICE' AND status IN ('SERVICE_CONFIRMED','CANCELLED'))),
  CONSTRAINT agreement_refs CHECK (
    (kind = 'PURCHASE' AND listing_id IS NOT NULL AND demand_id IS NOT NULL)
    OR (kind = 'BALING_SERVICE' AND baling_service_id IS NOT NULL AND baling_request_id IS NOT NULL)),
  CHECK (seller_org_id <> buyer_org_id)
);
CREATE INDEX agreements_seller_idx ON agreements (seller_org_id);
CREATE INDEX agreements_buyer_idx ON agreements (buyer_org_id);
CREATE INDEX agreements_listing_idx ON agreements (listing_id);
CREATE INDEX agreements_demand_idx ON agreements (demand_id);

-- the two forward references that close the listing/draft <-> agreement cycle
ALTER TABLE material_listings
  ADD CONSTRAINT material_listings_source_agreement_fk FOREIGN KEY (source_agreement_id) REFERENCES agreements(id);
ALTER TABLE drafts
  ADD CONSTRAINT drafts_source_agreement_fk FOREIGN KEY (source_agreement_id) REFERENCES agreements(id);
CREATE INDEX material_listings_source_agreement_idx ON material_listings (source_agreement_id);

-- quantity_ledger (append-only) ----------------------------------------------------------------
CREATE TABLE quantity_ledger (
  id bigserial PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('LISTING','DEMAND')),
  subject_id uuid NOT NULL,
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  entry_kind text NOT NULL CHECK (entry_kind IN ('COMMIT','RELEASE')),
  qty_kg numeric(14,3) NOT NULL CHECK (qty_kg > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, subject_type, subject_id, entry_kind)
);
CREATE INDEX quantity_ledger_subject_idx ON quantity_ledger (subject_type, subject_id);
CREATE FUNCTION quantity_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'quantity_ledger is append-only' USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER quantity_ledger_no_update_delete BEFORE UPDATE OR DELETE ON quantity_ledger
  FOR EACH ROW EXECUTE FUNCTION quantity_ledger_append_only();

-- resale_allocations ---------------------------------------------------------------------------
CREATE TABLE resale_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agreement_id uuid NOT NULL REFERENCES agreements(id),
  draft_id uuid UNIQUE REFERENCES drafts(id),
  listing_id uuid UNIQUE REFERENCES material_listings(id),
  qty_kg numeric(14,3) NOT NULL CHECK (qty_kg > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','RELEASED')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (draft_id IS NOT NULL OR listing_id IS NOT NULL)
);
CREATE INDEX resale_allocations_source_idx ON resale_allocations (source_agreement_id);

-- media (bytea in PostgreSQL by default; S3 reserved) and image_assessments --------------------
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  owner_type text NOT NULL CHECK (owner_type IN ('DRAFT','LISTING')),
  owner_id uuid NOT NULL,
  storage_kind text NOT NULL DEFAULT 'db' CHECK (storage_kind IN ('db','s3')),
  storage_key text,
  content bytea,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880), -- 5 MB
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES users(id),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_storage_shape CHECK (
    (storage_kind = 'db' AND content IS NOT NULL AND octet_length(content) = size_bytes)
    OR (storage_kind = 's3' AND storage_key IS NOT NULL AND content IS NULL)),
  UNIQUE (owner_type, owner_id, sha256)
);
CREATE INDEX media_org_id_idx ON media (org_id);
CREATE INDEX media_owner_idx ON media (owner_type, owner_id);
CREATE TABLE image_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('OK','UNASSESSABLE','UNAVAILABLE','FAILED')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  model_id text,
  error_code text,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  UNIQUE (media_id)
);

-- matches --------------------------------------------------------------------------------------
CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route smallint NOT NULL CHECK (route BETWEEN 1 AND 4),
  supply_id uuid NOT NULL,
  demand_id uuid NOT NULL,
  rule_version text NOT NULL,
  score numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  weight_coverage numeric(4,3) CHECK (weight_coverage IS NULL OR weight_coverage BETWEEN 0 AND 1),
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  distance_km numeric(8,2) CHECK (distance_km IS NULL OR distance_km >= 0),
  supply_version int,
  demand_version int,
  tier smallint NOT NULL CHECK (tier IN (0, 1)),
  is_demo boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route, supply_id, demand_id, rule_version)
);
CREATE INDEX matches_supply_idx ON matches (supply_id);
CREATE INDEX matches_demand_idx ON matches (demand_id);

-- conversations and messages -------------------------------------------------------------------
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_identity_id uuid REFERENCES line_identities(id),
  user_id uuid REFERENCES users(id),
  org_id uuid REFERENCES organizations(id),
  channel text NOT NULL CHECK (channel IN ('farmer','baler','factory','web')),
  active_draft_id uuid REFERENCES drafts(id),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (line_identity_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX conversations_line_identity_idx ON conversations (line_identity_id);
CREATE INDEX conversations_user_idx ON conversations (user_id);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  text text,
  source_event_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

-- idempotency_keys -----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  org_id uuid NOT NULL REFERENCES organizations(id),
  scope text NOT NULL,
  key text NOT NULL CHECK (length(key) > 0),
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, scope, key)
);

-- Down Migration
DROP TABLE idempotency_keys;
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE matches;
DROP TABLE image_assessments;
DROP TABLE media;
DROP TABLE resale_allocations;
DROP TRIGGER quantity_ledger_no_update_delete ON quantity_ledger;
DROP TABLE quantity_ledger;
DROP FUNCTION quantity_ledger_append_only();
ALTER TABLE drafts DROP CONSTRAINT drafts_source_agreement_fk;
ALTER TABLE material_listings DROP CONSTRAINT material_listings_source_agreement_fk;
DROP TABLE agreements;
DROP TABLE offers;
DROP TABLE baling_requests;
DROP TABLE baling_services;
DROP TABLE purchase_demands;
DROP TABLE material_listings;
DROP TABLE drafts;
