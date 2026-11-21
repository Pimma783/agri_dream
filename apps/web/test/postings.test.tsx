// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { balingServicePatchSchema, purchaseDemandPatchSchema, type DraftView } from '@agrimatch/contracts';
import { BalerIntentPicker } from '@/components/baler-intent-picker';
import { DemandForm, ServiceForm } from '@/components/posting-form';
import { PostingActions } from '@/components/posting-actions';
import { ApiRequestError } from '@/lib/api-core';
import { navForRole } from '@/lib/nav';
import {
  buildDemandPatch,
  buildServicePatch,
  emptyDemandForm,
  emptyServiceForm,
  formatPostingPrice,
  parseList,
  qualityLines,
  type DemandFormState,
} from '@/lib/postings';
import type { PostingsApi } from '@/lib/postings-client';

afterEach(cleanup);

const okDemand = (over: Partial<DemandFormState> = {}): DemandFormState => ({
  ...emptyDemandForm(),
  materials: ['RICE_STRAW'],
  qty: '20',
  priceMode: 'FIXED',
  price: '1,200',
  province: 'อุตรดิตถ์',
  transport: 'EITHER',
  ...over,
});

function draftView(over: Partial<DraftView> = {}, data: Record<string, unknown> = {}): DraftView {
  return {
    draft: { id: 'd1', kind: 'PURCHASE_DEMAND', status: 'AWAITING_REVIEW', version: 2, data: { accepted_materials: ['RICE_STRAW'], target_qty_kg: '20000.000', price_mode: 'FIXED', max_unit_price_thb: '1200.0000', price_unit: 'TON', province: 'อุตรดิตถ์', ...data } },
    complete: true,
    missing_fields: [],
    ...over,
  };
}
const fakeApi = (post: unknown, patch: unknown = vi.fn()) => ({ post, patch }) as unknown as PostingsApi;

describe('patch builders', () => {
  it('builds a demand patch that the contract schema accepts, quantities only in kg or ton', () => {
    const r = buildDemandPatch(okDemand({ minLot: '5', minLotUnit: 'kg', from: '2026-11-21', to: '2026-12-01' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(purchaseDemandPatchSchema.safeParse(r.patch).success).toBe(true);
    expect(r.patch.target_quantity).toEqual({ value: '20', unit: 'ton' });
    expect(r.patch.min_lot).toEqual({ value: '5', unit: 'kg' });
    expect(r.patch.price).toEqual({ value: '1200', unit: 'ton' });
    expect(r.patch.window_from).toBe('2026-11-21T00:00:00+07:00');
    expect(r.patch.window_to).toBe('2026-12-01T23:59:59+07:00');
  });

  it('sends NEGOTIABLE without any price, and rejects a FIXED price of 0', () => {
    const neg = buildDemandPatch(okDemand({ priceMode: 'NEGOTIABLE', price: '0' }));
    expect(neg.ok && neg.patch.price_mode).toBe('NEGOTIABLE');
    expect(neg.ok && 'price' in neg.patch).toBe(false);
    for (const bad of ['0', '', '0.00', '-5', 'abc']) {
      const r = buildDemandPatch(okDemand({ price: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.price).toBeTruthy();
    }
    expect(buildDemandPatch(okDemand({ priceMode: '' })).ok).toBe(false);
  });

  it('requires an explicit confirmation for OTHER material', () => {
    const r = buildDemandPatch(okDemand({ materials: ['RICE_STRAW', 'OTHER'] }));
    expect(r.ok).toBe(false);
    expect(buildDemandPatch(okDemand({ materials: ['OTHER'], otherAcknowledged: true })).ok).toBe(true);
  });

  it('stores «ต้องตรวจยืนยัน» as a __verify flag next to the quality value', () => {
    const quality = emptyDemandForm().quality;
    quality.moisture_max_pct = { value: '15', verify: true };
    quality.contamination = { value: '', verify: false };
    const r = buildDemandPatch(okDemand({ quality }));
    expect(r.ok && r.patch.quality).toEqual({ moisture_max_pct: '15', moisture_max_pct__verify: true });
    const lines = qualityLines({ moisture_max_pct: '15', moisture_max_pct__verify: true, bale_spec: 'x' });
    expect(lines).toEqual([
      { label: 'ความชื้นสูงสุด (%)', value: '15', needsVerify: true },
      { label: 'ขนาดหรือน้ำหนักก้อน', value: 'x', needsVerify: false },
    ]);
    quality.contamination = { value: '', verify: true };
    expect(buildDemandPatch(okDemand({ quality })).ok).toBe(false);
  });

  it('validates date order, radius and province lists', () => {
    expect(buildDemandPatch(okDemand({ from: '2026-12-02', to: '2026-12-01' })).ok).toBe(false);
    expect(buildDemandPatch(okDemand({ radius: '0' })).ok).toBe(false);
    expect(parseList('ก, ข，ก\nค')).toEqual(['ก', 'ข，ก', 'ค']);
    const r = buildDemandPatch(okDemand({ radius: '60', provinces: 'พิษณุโลก, สุโขทัย' }));
    expect(r.ok && r.patch.accepted_provinces).toEqual(['พิษณุโลก', 'สุโขทัย']);
  });

  it('builds a baling service patch with bale pricing', () => {
    const r = buildServicePatch({ ...emptyServiceForm(), materials: ['RICE_STRAW'], mode: 'ON_SITE', priceMode: 'FIXED', price: '25', priceUnit: 'bale', province: 'นครสวรรค์', transport: 'SELLER', capacity: '3', capacityUnit: 'ton' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(balingServicePatchSchema.safeParse(r.patch).success).toBe(true);
    expect(r.patch.price).toEqual({ value: '25', unit: 'bale' });
    expect(buildServicePatch(emptyServiceForm()).ok).toBe(false);
  });

  it('shows «ต่อรองได้» instead of a zero price', () => {
    expect(formatPostingPrice('NEGOTIABLE', null, null)).toBe('ต่อรองได้');
    expect(formatPostingPrice('NEGOTIABLE', '0', 'KG')).toBe('ต่อรองได้');
    expect(formatPostingPrice('FIXED', '1200.0000', 'TON')).toBe('1,200 บาท/ตัน');
  });
});

function fillDemand() {
  fireEvent.click(screen.getByLabelText('ฟางข้าว'));
  fireEvent.change(screen.getByLabelText('ปริมาณที่ต้องการ จำนวน'), { target: { value: '20' } });
  fireEvent.click(screen.getByLabelText('กำหนดราคา'));
  fireEvent.change(screen.getByLabelText('ราคา จำนวน'), { target: { value: '1200' } });
  fireEvent.change(screen.getByLabelText('จังหวัดที่ตั้ง'), { target: { value: 'อุตรดิตถ์' } });
  fireEvent.click(screen.getByLabelText('ได้ทั้งสองแบบ'));
}

describe('DemandForm', () => {
  it('offers only kg and ton for quantities', () => {
    render(<DemandForm api={fakeApi(vi.fn())} />);
    const select = screen.getByLabelText('ปริมาณที่ต้องการ หน่วย') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['ton', 'kg']);
  });

  it('shows the OTHER notice and blocks review until confirmed', () => {
    const post = vi.fn();
    render(<DemandForm api={fakeApi(post)} />);
    fillDemand();
    fireEvent.click(screen.getByLabelText('อื่น ๆ'));
    expect(screen.getByText(/ยังไม่ถูกจับคู่อัตโนมัติ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    expect(screen.getByText('ยืนยันเงื่อนไขของวัสดุ "อื่น ๆ" ก่อน')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('creates a draft, shows the preview with missing fields, and cannot publish until complete', async () => {
    const post = vi.fn(async () => draftView({ complete: false, missing_fields: ['target_qty_kg', 'province'] }, {}));
    render(<DemandForm api={fakeApi(post)} />);
    fillDemand();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    const missing = await screen.findByTestId('missing-fields');
    expect(within(missing).getByText('ปริมาณที่ต้องการ')).toBeTruthy();
    expect(within(missing).getByText('จังหวัด')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ประกาศ' }) as HTMLButtonElement).disabled).toBe(true);
    const [path, , body] = post.mock.calls[0] as unknown as [string, unknown, { kind: string; patch: Record<string, unknown> }];
    expect(path).toBe('/drafts');
    expect(body.kind).toBe('PURCHASE_DEMAND');
    expect(body.patch.target_quantity).toEqual({ value: '20', unit: 'ton' });
    // The estimate label is shown in the preview.
    expect(screen.getAllByTestId('estimate-label').length).toBeGreaterThan(0);
  });

  it('patches with expectedVersion on the second review, then publishes with an Idempotency-Key reused on retry', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(draftView({}, {}))
      .mockRejectedValueOnce(new ApiRequestError(500, 'INTERNAL', 'ระบบขัดข้อง'))
      .mockResolvedValueOnce({ draft_id: 'd1', entity_type: 'DEMAND', entity_id: 'e9', draft_version: 3, replayed: false });
    const patch = vi.fn(async () => draftView({ draft: { id: 'd1', kind: 'PURCHASE_DEMAND', status: 'AWAITING_REVIEW', version: 3, data: {} } }));
    const onPublished = vi.fn();
    render(<DemandForm api={fakeApi(post, patch)} onPublished={onPublished} />);
    fillDemand();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    await screen.findByRole('button', { name: 'ประกาศ' });
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไข' }));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]).toMatchObject(['/drafts/d1', expect.anything(), { expectedVersion: 2 }]);

    // first publish fails, retry succeeds with the same key
    fireEvent.click(await screen.findByRole('button', { name: 'ประกาศ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ระบบขัดข้อง');
    fireEvent.click(screen.getByRole('button', { name: 'ประกาศ' }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'e9' })));
    const first = post.mock.calls[1] as unknown as [string, unknown, unknown, Record<string, string>];
    const second = post.mock.calls[2] as unknown as [string, unknown, unknown, Record<string, string>];
    expect(first[0]).toBe('/drafts/d1/publish');
    expect(first[2]).toEqual({ expectedVersion: 3 });
    expect(first[3]['Idempotency-Key']).toBeTruthy();
    expect(second[3]['Idempotency-Key']).toBe(first[3]['Idempotency-Key']);
  });

  it('shows the Thai API message for a stale version', async () => {
    const post = vi.fn(async () => { throw new ApiRequestError(409, 'STALE_VERSION', 'ข้อมูลเปลี่ยนไปแล้ว'); });
    render(<DemandForm api={fakeApi(post)} />);
    fillDemand();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ข้อมูลเปลี่ยนไปแล้ว');
  });

  it('uses touch targets of at least 44px for inputs and the submit button', () => {
    render(<DemandForm api={fakeApi(vi.fn())} />);
    expect(screen.getByLabelText('จังหวัดที่ตั้ง').className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }).className).toContain('min-h-11');
  });
});

describe('ServiceForm', () => {
  it('creates a BALING_SERVICE draft with a bale price', async () => {
    const post = vi.fn(async () => draftView({ draft: { id: 's1', kind: 'BALING_SERVICE', status: 'AWAITING_REVIEW', version: 1, data: { material_types: ['RICE_STRAW'], service_mode: 'ON_SITE', price_mode: 'NEGOTIABLE', province: 'นครสวรรค์', transport_by: 'SELLER' } } }));
    render(<ServiceForm api={fakeApi(post)} />);
    fireEvent.click(screen.getByLabelText('ฟางข้าว'));
    fireEvent.click(screen.getByLabelText('อัดที่แปลง'));
    fireEvent.click(screen.getByLabelText('ต่อรองได้'));
    expect(screen.queryByLabelText('ราคา จำนวน')).toBeNull();
    fireEvent.change(screen.getByLabelText('จังหวัดที่ตั้ง'), { target: { value: 'นครสวรรค์' } });
    fireEvent.click(screen.getByLabelText('ผู้ขายส่งให้'));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจก่อนประกาศ' }));
    expect(await screen.findByRole('button', { name: 'ประกาศ' })).toBeTruthy();
    const body = (post.mock.calls[0] as unknown as [string, unknown, { kind: string; patch: Record<string, unknown> }])[2];
    expect(body.kind).toBe('BALING_SERVICE');
    expect(body.patch).toMatchObject({ price_mode: 'NEGOTIABLE', service_mode: 'ON_SITE' });
    expect('price' in body.patch).toBe(false);
    expect(screen.getByText('ต่อรองได้')).toBeTruthy();
  });
});

describe('BalerIntentPicker', () => {
  it('has no default choice and navigates only after an explicit pick', () => {
    const navigate = vi.fn();
    render(<BalerIntentPicker navigate={navigate} />);
    const resale = screen.getByLabelText(/รับซื้อเพื่อขายต่อ/) as HTMLInputElement;
    const service = screen.getByLabelText(/รับจ้างอัด/) as HTMLInputElement;
    expect(resale.checked).toBe(false);
    expect(service.checked).toBe(false);
    const go = screen.getByRole('button', { name: 'ต่อไป' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(service);
    fireEvent.click(go);
    expect(navigate).toHaveBeenCalledWith('/services/new');
    fireEvent.click(resale);
    fireEvent.click(go);
    expect(navigate).toHaveBeenLastCalledWith('/demands/new?intent=resale');
  });
});

describe('PostingActions', () => {
  const row = { id: 'x', status: 'PAUSED', version: 4 };
  it('offers open/close/cancel for PAUSED, and nothing for CLOSED', () => {
    const { rerender } = render(<PostingActions resource="purchase-demands" id="x" status="PAUSED" version={4} api={fakeApi(vi.fn())} />);
    expect(screen.getByRole('button', { name: 'เปิดประกาศ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'พักประกาศ' })).toBeNull();
    rerender(<PostingActions resource="purchase-demands" id="x" status="CLOSED" version={4} api={fakeApi(vi.fn())} />);
    expect(screen.queryByRole('button')).toBeNull();
    void row;
  });

  it('pauses with expectedVersion; close asks for confirmation first', async () => {
    const post = vi.fn(async () => ({}));
    const onDone = vi.fn();
    render(<PostingActions resource="baling-services" id="x" status="PUBLISHED" version={7} api={fakeApi(post)} onDone={onDone} />);
    // The strict response schema is bypassed by the fake; only the request is checked.
    fireEvent.click(screen.getByRole('button', { name: 'พักประกาศ' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post.mock.calls[0]).toMatchObject(['/baling-services/x/pause', expect.anything(), { expectedVersion: 7 }]);

    fireEvent.click(screen.getByRole('button', { name: 'ปิดประกาศ' }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ยืนยันปิดประกาศ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1] as unknown as [string])[0]).toBe('/baling-services/x/close');
  });

  it('shows the API error when the version is stale', async () => {
    const post = vi.fn(async () => { throw new ApiRequestError(409, 'STALE_VERSION', 'ข้อมูลเปลี่ยนไปแล้ว'); });
    render(<PostingActions resource="purchase-demands" id="x" status="PUBLISHED" version={1} api={fakeApi(post)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'พักประกาศ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ข้อมูลเปลี่ยนไปแล้ว');
  });
});

describe('navigation', () => {
  it('marks demands and services ready for the roles that own them', () => {
    const ready = (role: 'FACTORY' | 'BALER', href: string) => navForRole(role).find((i) => i.href === href)?.ready;
    expect(ready('FACTORY', '/demands')).toBe(true);
    expect(ready('BALER', '/demands')).toBe(true);
    expect(ready('BALER', '/services')).toBe(true);
    expect(ready('BALER', '/offers')).toBe(true);
  });
});
