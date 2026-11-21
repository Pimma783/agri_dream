// Allowlist view of an offer for HTTP clients: decimals as strings, timestamps as ISO, no idempotency key or versions of other rows.
import type { Offer } from '../../repos/index.js';

export interface OfferView {
  id: string;
  kind: Offer['kind'];
  from_org_id: string;
  to_org_id: string;
  listing_id: string | null;
  demand_id: string | null;
  baling_service_id: string | null;
  baling_request_id: string | null;
  qty_kg: string;
  unit_price_thb: string | null;
  price_unit: Offer['price_unit'];
  total_amount_thb: string | null;
  transport_by: Offer['transport_by'];
  transport_cost_thb: string | null;
  ready_date: string | null;
  expires_at: string;
  ack_pending_material: boolean;
  status: Offer['status'];
  supersedes_offer_id: string | null;
  version: number;
  is_demo: boolean;
  created_at: string;
  /** Relative to the caller: 'sent' when the caller's organization is the sender. */
  direction: 'sent' | 'received';
}

export function toOfferView(o: Offer, actorOrgId: string): OfferView {
  return {
    id: o.id, kind: o.kind, from_org_id: o.from_org_id, to_org_id: o.to_org_id,
    listing_id: o.listing_id, demand_id: o.demand_id, baling_service_id: o.baling_service_id, baling_request_id: o.baling_request_id,
    qty_kg: o.qty_kg, unit_price_thb: o.unit_price_thb, price_unit: o.price_unit, total_amount_thb: o.total_amount_thb,
    transport_by: o.transport_by, transport_cost_thb: o.transport_cost_thb, ready_date: o.ready_date,
    expires_at: o.expires_at.toISOString(), ack_pending_material: o.ack_pending_material, status: o.status,
    supersedes_offer_id: o.supersedes_offer_id, version: o.version, is_demo: o.is_demo, created_at: o.created_at.toISOString(),
    direction: o.from_org_id === actorOrgId ? 'sent' : 'received',
  };
}
