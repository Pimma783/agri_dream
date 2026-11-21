// Row factories for DB tests. Everything is synthetic (no real people, places or contacts) and
// is_demo=false, so tests exercise the same code paths as production data. Quantities and prices
// are decimal strings. Each factory accepts any Db (pool, rollback client or concurrent client).
import { randomBytes } from 'node:crypto';
import {
  type Db, demands, listings, memberships, offers, organizations, users,
  type Demand, type Listing, type Membership, type Offer, type Organization, type User,
} from '../src/repos/index.js';

// Random per-process prefix plus a counter: unique even if several files share a table.
const run = randomBytes(4).toString('hex');
let seq = 0;
const next = () => `${run}-${++seq}`;

type OrgKind = Organization['kind'];

export function makeOrg(db: Db, kind: OrgKind = 'FARMER', over: Partial<Organization> = {}): Promise<Organization> {
  return organizations.insert(db, {
    kind, name: `synthetic-${kind.toLowerCase()}-${next()}`, province: 'Test Province', is_demo: false, ...over,
  });
}

export function makeUser(db: Db, over: Partial<User> = {}): Promise<User> {
  const n = next();
  return users.insert(db, { display_name: `synthetic-user-${n}`, email: `user-${n}@example.invalid`, is_demo: false, ...over });
}

/** A user who belongs to `orgId`. */
export async function makeMember(
  db: Db, orgId: string, role: Membership['member_role'] = 'OWNER',
): Promise<{ user: User; membership: Membership }> {
  const user = await makeUser(db);
  const membership = await memberships.insert(db, { user_id: user.id, org_id: orgId, member_role: role });
  return { user, membership };
}

/** An organization plus one OWNER user. */
export async function makeOrgWithUser(db: Db, kind: OrgKind = 'FARMER') {
  const org = await makeOrg(db, kind);
  const { user } = await makeMember(db, org.id);
  return { org, user };
}

/** A published, fixed-price sale listing. `qty` is the full quantity in kg (committed 0). */
export function makeListing(db: Db, orgId: string, over: Partial<Listing> & { qty?: string } = {}): Promise<Listing> {
  const { qty = '10000.000', ...rest } = over;
  return listings.insert(db, {
    org_id: orgId, kind: 'SALE', material_type: 'RICE_STRAW', total_qty_kg: qty, remaining_qty_kg: qty,
    price_mode: 'FIXED', unit_price_thb: '1.5000', price_unit: 'KG', status: 'PUBLISHED', is_demo: false, ...rest,
  });
}

/** A published purchase demand. `qty` is the target in kg (committed 0). */
export function makeDemand(db: Db, orgId: string, over: Partial<Demand> & { qty?: string } = {}): Promise<Demand> {
  const { qty = '50000.000', ...rest } = over;
  return demands.insert(db, {
    org_id: orgId, accepted_materials: ['RICE_STRAW'], target_qty_kg: qty, remaining_qty_kg: qty,
    price_mode: 'FIXED', max_unit_price_thb: '2.0000', price_unit: 'KG', status: 'PUBLISHED', is_demo: false, ...rest,
  });
}

/** A PENDING purchase offer from the demand's org to the listing's org. */
export function makeOffer(
  db: Db,
  p: { listing: Listing; demand: Demand },
  over: Partial<Offer> = {},
): Promise<Offer> {
  return offers.insert(db, {
    kind: 'PURCHASE', from_org_id: p.demand.org_id, to_org_id: p.listing.org_id, listing_id: p.listing.id,
    demand_id: p.demand.id, qty_kg: '1000.000', unit_price_thb: '1.5000', price_unit: 'KG', transport_by: 'BUYER',
    expires_at: new Date(Date.now() + 24 * 3600_000), status: 'PENDING', is_demo: false, ...over,
  });
}

/** A farmer org, a factory org, one listing, one demand and one pending offer between them. */
export async function makeMarket(db: Db, over: { listingQty?: string; demandQty?: string; offerQty?: string } = {}) {
  const farmer = await makeOrgWithUser(db, 'FARMER');
  const factory = await makeOrgWithUser(db, 'BUYER_FACTORY');
  const listing = await makeListing(db, farmer.org.id, over.listingQty ? { qty: over.listingQty } : {});
  const demand = await makeDemand(db, factory.org.id, over.demandQty ? { qty: over.demandQty } : {});
  const offer = await makeOffer(db, { listing, demand }, over.offerQty ? { qty_kg: over.offerQty } : {});
  return { farmer, factory, listing, demand, offer };
}
/** Smallest valid-signature PNG/JPEG byte strings with distinct filler so each has a different sha256. */
export function makeImageBytes(kind: 'png' | 'jpeg' = 'jpeg', filler = 0, size = 64): Buffer {
  const head = kind === 'png' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [0xff, 0xd8, 0xff, 0xe0];
  const b = Buffer.alloc(Math.max(size, head.length + 4), filler & 0xff);
  Buffer.from(head).copy(b);
  b.writeUInt32BE(filler >>> 0, head.length);
  return b;
}
