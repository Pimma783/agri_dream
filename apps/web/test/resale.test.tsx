// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  draftViewListSchema,
  listingViewListSchema,
  type AgreementView,
  type DraftView,
  type ListingView,
  type MatchView,
} from '@agrimatch/contracts';
import { CreateOfferForm } from '@/components/offer-form';
import { MatchCards, MatchDetail } from '@/components/match-views';
import { ResaleEditor } from '@/components/resale-editor';
import { ResaleDraftCards, ResaleListingCards } from '@/components/resale-views';
import { ApiRequestError } from '@/lib/api-core';
import type { OffersApi } from '@/lib/offers';
import { navForRole } from '@/lib/nav';
import { buildResalePatch, formFromDraft, maxResaleKg, openResaleDrafts, resaleListings, type ResaleApi } from '@/lib/resale';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
afterEach(cleanup);

const AGREEMENT_ID = '8f3a21c0-1111-4222-8333-444455556666';
const draft = (data: Record<string, unknown> = {}, over: Partial<DraftView['draft']> = {}, extra: Partial<DraftView> = {}): DraftView => ({
  draft: {
    id: 'dr1', kind: 'RESALE_LISTING', status: 'DRAFT', version: 2,
    data: { material_type: 'RICE_STRAW', qty_kg: '3000.000', pending_material: true, ...data },
    source_agreement_id: AGREEMENT_ID, created_at: '2025-03-02T00:00:00.000Z', ...over,
  },
  complete: false,
  missing_fields: ['material_form', 'price_mode', 'province', 'expected_ready_at'],
  ...extra,
});
const listing = (over: Partial<ListingView> = {}): ListingView => ({
  id: 'l1', kind: 'RESALE', status: 'PUBLISHED', version: 1, material_type: 'RICE_STRAW', material_form: 'BALED',
  total_qty_kg: '2000.000', committed_qty_kg: '500.000', remaining_qty_kg: '1500.000', price_mode: 'FIXED', unit_price_thb: '1500.0000',
  price_unit: 'TON', province: 'อุตรดิตถ์', district: null, pending_material: true, expected_ready_at: '2025-04-10T00:00:00.000Z',
  source_agreement_id: AGREEMENT_ID, created_at: '2025-03-03T00:00:00.000Z', ...over,
});
const agreement = (over: Partial<AgreementView> = {}): AgreementView => ({
  id: AGREEMENT_ID, kind: 'PURCHASE', offer_id: 'o1', seller_org_id: 's', buyer_org_id: 'me', listing_id: 'l', demand_id: 'd',
  baling_service_id: null, baling_request_id: null, qty_kg: '5000.000', unit_price_thb: '1200.0000', price_unit: 'TON',
  total_amount_thb: '6000.00', status: 'PURCHASE_CONFIRMED', resale_reserved_kg: '4000.000', source_agreement_id: null, version: 1,
  is_demo: false, confirmed_at: '2025-03-01T00:00:00.000Z', ...over,
});
const apiWith = (api: Partial<Record<'post' | 'patch', unknown>>) => api as unknown as ResaleApi;

describe('resale helpers', () => {
  it('parses API-shaped draft and listing lists', () => {
    expect(draftViewListSchema.safeParse([draft()]).success).toBe(true);
    expect(listingViewListSchema.safeParse([listing()]).success).toBe(true);
  });
  it('keeps open resale drafts and resale listings only', () => {
    const list = [
      draft(),
      draft({}, { id: 'p', status: 'PUBLISHED' }),
      draft({}, { id: 'c', status: 'CANCELLED' }),
      draft({}, { id: 'x', kind: 'PURCHASE_DEMAND' }),
    ];
    expect(openResaleDrafts(list).map((v) => v.draft.id)).toEqual(['dr1']);
    expect(resaleListings([listing(), listing({ id: 's', kind: 'SALE' })]).map((l) => l.id)).toEqual(['l1']);
  });
  it('max quantity adds back the draft own reservation', () => {
    // 5000 total, 4000 reserved of which 3000 is this draft: 5000 - 4000 + 3000
    expect(maxResaleKg(agreement(), '3000.000')).toBe('4000.000');
    expect(maxResaleKg(agreement({ resale_reserved_kg: '5000.000' }), null)).toBe('0.000');
  });
  it('rejects a quantity above the reservation and sends NEGOTIABLE without a price', () => {
    const f = { ...formFromDraft(draft().draft.data), qty: '5', qtyUnit: 'ton' as const };
    const over = buildResalePatch(f, '4000.000');
    expect(over.ok).toBe(false);
    const ok = buildResalePatch({ ...f, qty: '4', priceMode: 'NEGOTIABLE', price: '99' }, '4000.000');
    expect(ok.ok && ok.patch).toMatchObject({ quantity: { value: '4', unit: 'ton' }, price_mode: 'NEGOTIABLE', pending_material: true });
    expect(ok.ok && 'price' in ok.patch).toBe(false);
  });
  it('sends the expected-ready date as a Bangkok day and nothing when not pending', () => {
    const base = { ...formFromDraft(draft().draft.data), expectedReady: '2025-04-10' };
    const pend = buildResalePatch(base, '4000.000');
    expect(pend.ok && pend.patch.expected_ready_at).toBe('2025-04-10T00:00:00+07:00');
    const ready = buildResalePatch({ ...base, pending: false }, '4000.000');
    expect(ready.ok && ready.patch.pending_material).toBe(false);
    expect(ready.ok && 'expected_ready_at' in ready.patch).toBe(false);
  });
});

describe('navigation', () => {
  it('«ขายต่อ» is enabled for BALER only', () => {
    const item = navForRole('BALER').find((n) => n.href === '/resale');
    expect(item?.ready).toBe(true);
    expect(navForRole('FACTORY').some((n) => n.href === '/resale')).toBe(false);
    expect(navForRole('FARMER').some((n) => n.href === '/resale')).toBe(false);
  });
});

describe('resale list cards', () => {
  it('shows reserved vs listed quantity, pending status with date, and only a source reference', () => {
    render(<ResaleDraftCards items={[draft({ expected_ready_at: '2025-04-10T00:00:00.000Z' })]} agreements={[agreement()]} />);
    const card = within(screen.getByRole('list', { name: 'ร่างประกาศขายต่อ' })).getAllByRole('listitem')[0] as HTMLElement;
    expect(card.textContent).toContain('ปริมาณที่จองไว้');
    expect(card.textContent).toContain('3,000');
    expect(card.textContent).toContain('ยังไม่ได้เผยแพร่');
    expect(within(card).getByTestId('pending-material').textContent).toContain('รอรับ/รออัด');
    expect(within(card).getByTestId('pending-material').textContent).toContain('คาดว่าพร้อม');
    expect(within(card).getByTestId('source-ref').textContent).toContain('#8F3A21C0');
    expect(within(card).getByRole('link', { name: 'แก้ไขร่าง' }).getAttribute('href')).toBe('/resale/dr1');
    cleanup();
    render(<ResaleListingCards items={[listing()]} agreements={[agreement()]} />);
    const l = within(screen.getByRole('list', { name: 'ประกาศขายต่อที่เผยแพร่' })).getAllByRole('listitem')[0] as HTMLElement;
    expect(l.textContent).toContain('ปริมาณที่ประกาศ');
    expect(l.textContent).toContain('คงเหลือ');
    expect(within(l).getByTestId('pending-material').textContent).toContain('รอรับ/รออัด');
    expect(l.querySelector('[data-status="PUBLISHED"]')).toBeTruthy();
  });
  it('flags a pending draft with no expected date', () => {
    render(<ResaleDraftCards items={[draft()]} />);
    expect(screen.getByTestId('pending-material').textContent).toContain('ยังไม่ระบุวันที่คาดว่าจะพร้อม');
  });
  it('does not render a ready listing as pending', () => {
    render(<ResaleListingCards items={[listing({ pending_material: false, expected_ready_at: null })]} />);
    expect(screen.queryByTestId('pending-material')).toBeNull();
  });
});

describe('ResaleEditor', () => {
  const props = { maxKg: '4000.000', source: { id: AGREEMENT_ID, confirmedAt: '2025-03-01T00:00:00.000Z' } };

  it('shows the source reference, remaining reservation, and the pre-baling image notice, with no farmer identity', () => {
    render(<ResaleEditor initial={draft()} {...props} />);
    expect(screen.getByTestId('source-ref').textContent).toContain('#8F3A21C0');
    expect(screen.getByTestId('max-qty').textContent).toContain('4,000');
    expect(screen.getByTestId('no-image-quality').textContent).toContain('ไม่ใช่หลักฐานคุณภาพหลังอัด');
    expect(document.body.textContent).not.toMatch(/เกษตรกร:|เบอร์|โทร/);
  });

  it('blocks a quantity above the reservation without calling the API', () => {
    const patch = vi.fn();
    render(<ResaleEditor initial={draft()} {...props} api={apiWith({ patch })} />);
    fireEvent.change(screen.getByLabelText('ปริมาณขายต่อ จำนวน'), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและตรวจก่อนเผยแพร่' }));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('เกินที่จองไว้');
  });

  it('uses province and district selects, clears district on province change, keeps legacy values', async () => {
    const patch = vi.fn(async () => draft({}, { version: 3 }));
    const { unmount } = render(<ResaleEditor initial={draft({ province: 'นครสวรรค์', district: 'ตาคลี' })} {...props} api={apiWith({ patch })} />);
    const province = screen.getByLabelText(/จังหวัดของผู้อัด/) as HTMLSelectElement;
    const district = screen.getByLabelText('อำเภอ (ถ้ามี)') as HTMLSelectElement;
    expect([province.tagName, district.tagName]).toEqual(['SELECT', 'SELECT']);
    expect(district.value).toBe('ตาคลี');
    expect(district.querySelectorAll('option').length).toBe(16);
    fireEvent.change(province, { target: { value: 'ภูเก็ต' } });
    expect(district.value).toBe('');
    expect(district.disabled).toBe(true);
    unmount();
    render(<ResaleEditor initial={draft({ province: 'Uttaradit city', district: 'ลับแล' })} {...props} api={apiWith({ patch })} />);
    expect((screen.getByLabelText(/จังหวัดของผู้อัด/) as HTMLSelectElement).value).toBe('Uttaradit city');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและตรวจก่อนเผยแพร่' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls[0] as unknown as [string, unknown, { patch: Record<string, unknown> }];
    expect(call[2].patch).toMatchObject({ province: 'Uttaradit city', district: 'ลับแล' });
  });
  it('shows the expected-date field only while pending', () => {
    render(<ResaleEditor initial={draft()} {...props} />);
    expect(screen.getByLabelText(/วันที่คาดว่าจะพร้อม/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /วัสดุยังไม่พร้อมส่ง/ }));
    expect(screen.queryByLabelText(/วันที่คาดว่าจะพร้อม/)).toBeNull();
  });

  it('saves with expectedVersion, lists missing fields, and cannot publish an incomplete draft', async () => {
    const patch = vi.fn(async () => draft({}, { version: 3 }));
    const post = vi.fn();
    render(<ResaleEditor initial={draft()} {...props} api={apiWith({ patch, post })} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและตรวจก่อนเผยแพร่' }));
    await waitFor(() => expect(screen.getByTestId('missing-fields')).toBeTruthy());
    const call = patch.mock.calls[0] as unknown as [string, unknown, { expectedVersion: number; patch: Record<string, unknown> }];
    expect(call[0]).toBe('/drafts/dr1');
    expect(call[2].expectedVersion).toBe(2);
    expect(call[2].patch).toMatchObject({ pending_material: true, quantity: { value: '3000', unit: 'kg' } });
    const list = screen.getByTestId('missing-fields').textContent ?? '';
    expect(list).toContain('วันที่คาดว่าจะพร้อม');
    expect(list).toContain('รูปแบบก้อน');
    expect((screen.getByRole('button', { name: 'เผยแพร่ประกาศ' }) as HTMLButtonElement).disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('publishes a complete draft with expectedVersion and an Idempotency-Key, reusing the key on retry', async () => {
    const complete = draft({ material_form: 'BALED', price_mode: 'NEGOTIABLE', province: 'อุตรดิตถ์', expected_ready_at: '2025-04-10T00:00:00.000Z' }, { version: 3 }, { complete: true, missing_fields: [] });
    const patch = vi.fn(async () => complete);
    const post = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError(0, 'NETWORK', 'เชื่อมต่อไม่ได้'))
      .mockResolvedValueOnce({ draft_id: 'dr1', entity_type: 'LISTING', entity_id: 'l9', draft_version: 3, replayed: false });
    render(<ResaleEditor initial={draft()} {...props} api={apiWith({ patch, post })} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและตรวจก่อนเผยแพร่' }));
    const publishBtn = await screen.findByRole('button', { name: 'เผยแพร่ประกาศ' });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publishBtn);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('เชื่อมต่อไม่ได้'));
    fireEvent.click(screen.getByRole('button', { name: 'เผยแพร่ประกาศ' }));
    await waitFor(() => expect(screen.getByText('เผยแพร่ประกาศขายต่อแล้ว')).toBeTruthy());
    type Call = [string, unknown, { expectedVersion: number }, Record<string, string>];
    const calls = post.mock.calls as unknown as Call[];
    const c1 = calls[0] as Call;
    const c2 = calls[1] as Call;
    expect(c1[0]).toBe('/drafts/dr1/publish');
    expect(c1[2]).toEqual({ expectedVersion: 3 });
    expect(c1[3]['Idempotency-Key']).toBeTruthy();
    expect(c2[3]['Idempotency-Key']).toBe(c1[3]['Idempotency-Key']);
    expect(screen.getByRole('link', { name: 'ไปที่รายการขายต่อ' }).getAttribute('href')).toBe('/resale');
  });

  it('cancels the draft after a confirmation and says the reservation is released', async () => {
    const post = vi.fn(async () => draft({}, { status: 'CANCELLED', version: 3 }));
    render(<ResaleEditor initial={draft()} {...props} api={apiWith({ post })} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกร่าง' }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกร่าง' }));
    await waitFor(() => expect(screen.getByText('ยกเลิกร่างแล้ว')).toBeTruthy());
    expect(post.mock.calls[0]).toMatchObject(['/drafts/dr1/cancel', expect.anything(), { expectedVersion: 2 }]);
    expect(screen.getByText(/คืนให้ข้อตกลงต้นทางแล้ว/)).toBeTruthy();
  });

  it('shows the API message when the reservation cap is exceeded', async () => {
    const patch = vi.fn().mockRejectedValue(new ApiRequestError(409, 'ALLOCATION_EXCEEDED', 'จัดสรรเกินปริมาณที่ซื้อมา'));
    render(<ResaleEditor initial={draft()} {...props} api={apiWith({ patch })} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและตรวจก่อนเผยแพร่' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('จัดสรรเกินปริมาณที่ซื้อมา'));
  });

  it('is read-only once published or cancelled', () => {
    render(<ResaleEditor initial={draft({}, { status: 'PUBLISHED' })} {...props} />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText(/แก้ไขไม่ได้/)).toBeTruthy();
  });
});

describe('factory view of a pending resale listing', () => {
  const m = (published: Record<string, unknown>): MatchView =>
    ({
      id: '11111111-1111-4111-8111-111111111111', route: 4, own_side: 'demand', own_entity_id: 'e', tier: 0, score: '80', score_label_th: 'x',
      weights_label_th: 'x', weights_disclaimer_th: 'x', weight_coverage: null, components: {}, missing_components: [], flags: [], reasons: [],
      distance: null, rule_version: 'v1', is_demo: true, computed_at: '2025-01-01T00:00:00.000Z',
      counterparty: { entity_type: 'LISTING', entity_id: 'l', display_name: 'ผู้อัดตัวอย่าง', org_kind: 'BALER', province: 'อุตรดิตถ์', published },
    }) as MatchView;
  const pending = { kind: 'RESALE', pending_material: true, expected_ready_at: '2025-04-10T00:00:00.000Z', remaining_qty_kg: '1500.000' };

  it('shows pending status and the expected date on the match card and the match detail', () => {
    render(<MatchCards items={[m(pending)]} />);
    expect(screen.getByTestId('pending-material').textContent).toMatch(/รอรับ\/รออัด · คาดว่าพร้อม/);
    cleanup();
    render(<MatchDetail m={m(pending)} />);
    expect(screen.getByTestId('pending-material').textContent).toMatch(/รอรับ\/รออัด · คาดว่าพร้อม/);
  });
  it('shows nothing extra for ready material', () => {
    render(<MatchCards items={[m({ pending_material: false, expected_ready_at: null })]} />);
    expect(screen.queryByTestId('pending-material')).toBeNull();
  });
  it('offer form shows the expected date, requires the acknowledgement and sends it', async () => {
    const post = vi.fn(async () => ({ offer: { id: 'o9' }, replayed: false }));
    // the offer result is parsed by the real API client; here the port is faked, so the body is what matters
    render(<CreateOfferForm match={m(pending)} api={{ post } as unknown as OffersApi} />);
    expect(screen.getByTestId('expected-ready').textContent).toContain('คาดว่าพร้อม');
    fireEvent.change(screen.getByLabelText('ปริมาณ จำนวน'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('ต้องติ๊กรับทราบก่อนส่งข้อเสนอ')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>])[2]).toMatchObject({ ackPendingMaterial: true });
  });
});
