// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { agreementViewSchema, offerViewSchema, type AgreementView, type MatchView, type OfferView } from '@agrimatch/contracts';
import { OfferActionsPanel } from '@/components/offer-actions';
import { CreateOfferForm } from '@/components/offer-form';
import { AgreementDetail, OfferCards, OfferDetail } from '@/components/offer-views';
import { ResaleDraftButton } from '@/components/resale-draft-button';
import { ApiRequestError } from '@/lib/api-core';
import { navForRole } from '@/lib/nav';
import { buildTerms, canCreateResale, emptyTermsForm, offerActions, qtyToKg, remainingKg, type OffersApi } from '@/lib/offers';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
afterEach(cleanup);

const offer = (over: Partial<OfferView> = {}): OfferView => ({
  id: 'o1', kind: 'PURCHASE', from_org_id: 'a', to_org_id: 'b', listing_id: 'l', demand_id: 'd', baling_service_id: null, baling_request_id: null,
  qty_kg: '5000.000', unit_price_thb: '1200.0000', price_unit: 'TON', total_amount_thb: '6000.00', transport_by: 'UNKNOWN',
  transport_cost_thb: null, ready_date: null, expires_at: '2025-03-01T17:30:00.000Z', ack_pending_material: false, status: 'PENDING',
  supersedes_offer_id: null, version: 3, is_demo: false, created_at: '2025-02-27T00:00:00.000Z', direction: 'received', ...over,
});
const agreement = (over: Partial<AgreementView> = {}): AgreementView => ({
  id: 'g1', kind: 'PURCHASE', offer_id: 'o1', seller_org_id: 's', buyer_org_id: 'me', listing_id: 'l', demand_id: 'd', baling_service_id: null,
  baling_request_id: null, qty_kg: '5000.000', unit_price_thb: '1200.0000', price_unit: 'TON', total_amount_thb: '6000.00',
  status: 'PURCHASE_CONFIRMED', resale_reserved_kg: '1500.500', source_agreement_id: null, version: 1, is_demo: false,
  confirmed_at: '2025-03-01T00:00:00.000Z', ...over,
});
const match = (published: Record<string, unknown> = {}, route = 1): MatchView =>
  ({
    id: '11111111-1111-4111-8111-111111111111', route, own_side: 'demand', own_entity_id: 'e', tier: 0, score: '80', score_label_th: 'x', weights_label_th: 'x',
    weights_disclaimer_th: 'x', weight_coverage: null, components: {}, missing_components: [], flags: [], reasons: [], distance: null, rule_version: 'v1',
    is_demo: true, computed_at: '2025-01-01T00:00:00.000Z',
    counterparty: { entity_type: 'LISTING', entity_id: 'l', display_name: 'ผู้ขายตัวอย่าง', org_kind: 'FARMER', province: 'อุตรดิตถ์', published },
  }) as MatchView;
const apiWith = (post: unknown) => ({ post }) as unknown as OffersApi;

describe('offer helpers', () => {
  it('parses API-shaped views', () => {
    expect(offerViewSchema.safeParse(offer()).success).toBe(true);
    expect(agreementViewSchema.safeParse(agreement()).success).toBe(true);
  });
  it('converts quantities without floating point and computes remaining', () => {
    expect(qtyToKg('5', 'ton')).toBe('5000.000');
    expect(qtyToKg('1,250.5', 'kg')).toBe('1250.5');
    expect(qtyToKg('abc', 'kg')).toBeNull();
    expect(remainingKg('5000.000', '1500.500')).toBe('3499.500');
    expect(remainingKg('10.000', '10.000')).toBe('0.000');
  });
  it('sends price and unit together or neither', () => {
    const f = { ...emptyTermsForm(), qty: '2' };
    const r = buildTerms(f);
    expect(r.terms).toMatchObject({ qtyKg: '2000.000', unitPriceThb: null, priceUnit: null, transportCostThb: null });
    expect(buildTerms({ ...f, price: '1,200' }).terms).toMatchObject({ unitPriceThb: '1200', priceUnit: 'TON' });
    expect(buildTerms({ ...f, qty: '0' }).errors.qty).toBeTruthy();
  });
  it('gives actions by side and status only', () => {
    expect(offerActions({ status: 'PENDING', direction: 'received' })).toMatchObject({ accept: true, reject: true, withdraw: false, edit: false });
    expect(offerActions({ status: 'PENDING', direction: 'sent' })).toMatchObject({ accept: false, withdraw: true, edit: true });
    expect(offerActions({ status: 'EXPIRED', direction: 'sent' })).toMatchObject({ withdraw: false, edit: false });
  });
  it('allows resale only for the BALER buyer of a confirmed purchase', () => {
    expect(canCreateResale(agreement(), { org_id: 'me', role: 'BALER' })).toBe(true);
    expect(canCreateResale(agreement(), { org_id: 'me', role: 'FACTORY' })).toBe(false);
    expect(canCreateResale(agreement({ buyer_org_id: 'x' }), { org_id: 'me', role: 'BALER' })).toBe(false);
    expect(canCreateResale(agreement({ kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED' }), { org_id: 'me', role: 'BALER' })).toBe(false);
  });
  it('marks offers and agreements ready in nav', () => {
    for (const role of ['FARMER', 'FACTORY', 'BALER'] as const) {
      expect(navForRole(role).find((i) => i.href === '/offers')?.ready).toBe(true);
    }
    expect(navForRole('FARMER').find((i) => i.href === '/agreements')?.ready).toBe(true);
    expect(navForRole('BALER').find((i) => i.href === '/agreements')?.ready).toBe(true);
  });
});

describe('offer views', () => {
  it('shows total and transport cost separately; no total when not computable', () => {
    const { rerender } = render(<OfferDetail o={offer({ transport_cost_thb: '300.00', transport_by: 'SELLER' })} />);
    expect(screen.getByTestId('offer-total').textContent).toContain('6,000.00');
    expect(screen.getByTestId('offer-transport-cost').textContent).toContain('300.00');
    expect(screen.getByTestId('offer-transport-cost').textContent).toContain('แยกจากยอดรวม');
    rerender(<OfferDetail o={offer({ total_amount_thb: null, unit_price_thb: null, price_unit: null })} />);
    expect(screen.getByTestId('offer-total').textContent).toContain('ยังคำนวณยอดรวมไม่ได้');
    expect(screen.getByTestId('offer-transport-cost').textContent).toContain('ยังไม่ทราบ');
    expect(screen.getByText(/หมดอายุ \(เวลาไทย\)/)).toBeTruthy();
  });
  it('renders offer cards with status badge and link', () => {
    render(<OfferCards items={[offer()]} />);
    expect(document.querySelector('[data-status="PENDING"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ดูข้อเสนอ' }).getAttribute('href')).toBe('/offers/o1');
  });
  it('agreement detail has the notice, remaining quantity and no payment claim', () => {
    render(<AgreementDetail a={agreement()} side="buyer" />);
    expect(screen.getByTestId('agreement-notice').textContent).toContain('ไม่ใช่การชำระเงิน การส่งมอบ หรือการรับรองคุณภาพ');
    expect(screen.getByTestId('resale-remaining').textContent).toContain('3,499.5');
    expect(screen.getAllByText('ยืนยันการซื้อแล้ว').length).toBeGreaterThan(0);
  });
  it('service agreement uses service wording and shows no resale quantity', () => {
    render(<AgreementDetail a={agreement({ kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED' })} side="seller" />);
    expect(screen.getAllByText('ยืนยันบริการแล้ว').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('resale-remaining')).toBeNull();
  });
});

describe('create offer form', () => {
  const fill = (qty: string) => fireEvent.change(screen.getByLabelText('ปริมาณ จำนวน'), { target: { value: qty } });
  it('sends matchId with an Idempotency-Key and links to the offer', async () => {
    const post = vi.fn(async () => ({ offer: offer({ id: 'new1' }), replayed: false }));
    render(<CreateOfferForm match={match()} api={apiWith(post)} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'ดูข้อเสนอ' }).getAttribute('href')).toBe('/offers/new1'));
    const [path, , body, headers] = post.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>, Record<string, string>];
    expect(path).toBe('/offers');
    expect(body).toMatchObject({ kind: 'PURCHASE', matchId: match().id, qtyKg: '5000.000' });
    expect(headers['Idempotency-Key']).toBeTruthy();
  });
  it('reuses the key for a retry of the same payload and changes it when the payload changes', async () => {
    const post = vi.fn(async () => { throw new ApiRequestError(0, 'NETWORK', 'เชื่อมต่อไม่ได้'); });
    render(<CreateOfferForm match={match()} api={apiWith(post)} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'ส่งข้อเสนอ' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'ส่งข้อเสนอ' }) as HTMLButtonElement).disabled).toBe(false));
    fill('6');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const keys = post.mock.calls.map((c) => (c as unknown as [string, unknown, unknown, Record<string, string>])[3]['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
  it('says the offer stays pending on INSUFFICIENT_QUANTITY', async () => {
    const post = vi.fn(async () => { throw new ApiRequestError(409, 'INSUFFICIENT_QUANTITY', 'ปริมาณคงเหลือไม่พอ'); });
    render(<CreateOfferForm match={match()} api={apiWith(post)} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ยังคงรอตอบรับอยู่'));
  });
  it('requires the pending-material acknowledgement before sending', async () => {
    const post = vi.fn(async () => ({ offer: offer(), replayed: false }));
    render(<CreateOfferForm match={match({ pending_material: true })} api={apiWith(post)} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('ต้องติ๊กรับทราบก่อนส่งข้อเสนอ')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>])[2]).toMatchObject({ ackPendingMaterial: true });
  });
  it('uses BALING_SERVICE kind for route 3', async () => {
    const post = vi.fn(async () => ({ offer: offer({ kind: 'BALING_SERVICE' }), replayed: false }));
    render(<CreateOfferForm match={match({}, 3)} api={apiWith(post)} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>])[2]).toMatchObject({ kind: 'BALING_SERVICE' });
  });
});

describe('offer actions', () => {
  it('receiver accepts and gets a link to the agreement', async () => {
    const post = vi.fn(async () => ({ agreement: agreement({ id: 'g9' }), offer: offer({ status: 'ACCEPTED' }), replayed: false }));
    render(<OfferActionsPanel offer={offer()} api={apiWith(post)} />);
    expect(screen.queryByRole('button', { name: 'ถอนข้อเสนอ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ตอบรับข้อเสนอ' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'ดูข้อตกลง' }).getAttribute('href')).toBe('/agreements/g9'));
    expect((post.mock.calls[0] as unknown as [string])[0]).toBe('/offers/o1/accept');
  });
  it('asks for the acknowledgement after a validation failure on accept', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError(422, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง', ['ackPendingMaterial']))
      .mockResolvedValueOnce({ agreement: agreement(), offer: offer({ status: 'ACCEPTED' }), replayed: false });
    render(<OfferActionsPanel offer={offer()} api={apiWith(post)} />);
    fireEvent.click(screen.getByRole('button', { name: 'ตอบรับข้อเสนอ' }));
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: 'ตอบรับข้อเสนอ' }));
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'ตอบรับข้อเสนอ' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1] as unknown as [string, unknown, Record<string, unknown>])[2]).toEqual({ ackPendingMaterial: true });
  });
  it('shows the pending message on INSUFFICIENT_QUANTITY at accept', async () => {
    const post = vi.fn(async () => { throw new ApiRequestError(409, 'INSUFFICIENT_QUANTITY', 'x'); });
    render(<OfferActionsPanel offer={offer()} api={apiWith(post)} />);
    fireEvent.click(screen.getByRole('button', { name: 'ตอบรับข้อเสนอ' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ยังคงรอตอบรับอยู่'));
  });
  it('sender withdraws after confirming, and can edit', async () => {
    const post = vi.fn(async () => ({ offer: offer({ status: 'WITHDRAWN' }), replayed: false }));
    render(<OfferActionsPanel offer={offer({ direction: 'sent' })} api={apiWith(post)} />);
    expect(screen.queryByRole('button', { name: 'ตอบรับข้อเสนอ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ถอนข้อเสนอ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(screen.getByText('ถอนข้อเสนอแล้ว')).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/offers/o1/withdraw', expect.anything(), { expectedVersion: 3 }, expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
  });
  it('edit posts changes with the current version', async () => {
    const post = vi.fn(async () => ({ offer: offer({ id: 'o2', direction: 'sent' }), replaced: offer(), replayed: false }));
    render(<OfferActionsPanel offer={offer({ direction: 'sent' })} api={apiWith(post)} />);
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไขข้อเสนอ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อเสนอใหม่' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'ดูข้อเสนอใหม่' }).getAttribute('href')).toBe('/offers/o2'));
    expect((post.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>])[2]).toMatchObject({ expectedVersion: 3, changes: { qtyKg: '5000' } });
  });
  it('shows no actions for a finished offer', () => {
    render(<OfferActionsPanel offer={offer({ status: 'REJECTED' })} api={apiWith(vi.fn())} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('resale draft button', () => {
  it('creates a draft and links to it', async () => {
    const post = vi.fn(async () => ({ draft: { id: 'dr1', kind: 'RESALE_LISTING', status: 'COLLECTING', version: 1, data: {} }, complete: false, missing_fields: [] }));
    render(<ResaleDraftButton agreementId="g1" api={apiWith(post)} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างประกาศขายต่อ' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'เปิดร่างประกาศ' }).getAttribute('href')).toBe('/resale/dr1'));
    expect((post.mock.calls[0] as unknown as [string])[0]).toBe('/agreements/g1/resale-draft');
  });
  it('disables when nothing is left to resell', () => {
    render(<ResaleDraftButton agreementId="g1" disabled api={apiWith(vi.fn())} />);
    expect((screen.getByRole('button', { name: 'สร้างประกาศขายต่อ' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
