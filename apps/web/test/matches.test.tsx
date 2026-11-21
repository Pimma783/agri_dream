// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { matchListSchema, type MatchView } from '@agrimatch/contracts';
import { MatchCards, MatchDetail } from '@/components/match-views';
import { findMatch, flagChipText, offerHref } from '@/lib/matches';
import { navForRole } from '@/lib/nav';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

function match(over: Partial<MatchView> = {}): MatchView {
  return {
    id: 'm1',
    route: 1,
    own_side: 'supply',
    own_entity_id: 'e1',
    tier: 1,
    score: '86.50',
    score_label_th: 'ประมาณการ',
    weights_label_th: 'ค่าเริ่มต้นสำหรับเดโม',
    weights_disclaimer_th: 'น้ำหนักคะแนนเป็นค่าเริ่มต้นสำหรับทดสอบเดโม ไม่ใช่สูตรที่พิสูจน์ว่าดีที่สุด',
    weight_coverage: '0.8000',
    components: {
      distance: { value: '0.9000', weight: '0.3000' },
      price: { value: null, weight: '0.2000' },
    },
    missing_components: ['price'],
    flags: [
      { code: 'INCOMPLETE', label_th: 'ข้อมูลไม่ครบ' },
      { code: 'NEEDS_CONFIRMATION', field: 'moisture_max_pct', label_th: 'x' },
      { code: 'DISTANCE_UNVERIFIED', label_th: 'x' },
      { code: 'PRICE_MISMATCH', label_th: 'x' },
    ],
    reasons: [{ code: 'DISTANCE_KM', params: { km: '12.3' }, text_th: 'ระยะเส้นตรง 12.3 กม. (ไม่ใช่ระยะขับรถ)' }],
    distance: { km: '12.30', kind: 'straight_line', label_th: 'ระยะเส้นตรง (ไม่ใช่ระยะขับรถ)' },
    rule_version: 'v1',
    is_demo: true,
    computed_at: '2025-01-01T00:00:00.000Z',
    counterparty: {
      entity_type: 'DEMAND',
      entity_id: 'd1',
      display_name: 'โรงงานตัวอย่าง',
      org_kind: 'BUYER_FACTORY',
      province: 'อุตรดิตถ์',
      published: { remaining_qty_kg: '5000.000', max_unit_price_thb: '1200.0000', price_unit: 'TON' },
    },
    ...over,
  };
}

describe('match contracts', () => {
  it('parses an API-shaped match list and rejects a bad tier', () => {
    expect(matchListSchema.safeParse([match()]).success).toBe(true);
    expect(matchListSchema.safeParse([{ ...match(), tier: 2 }]).success).toBe(false);
  });
});

describe('MatchCards', () => {
  it('labels score as estimate with demo weights, shows flag chips, province only, no contact data', () => {
    render(<MatchCards items={[match()]} />);
    const card = within(screen.getByRole('list', { name: 'ผลจับคู่' })).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(card).getByTestId('estimate-label').textContent).toBe('ประมาณการ');
    expect(within(card).getByTestId('demo-weights-label').textContent).toBe('ค่าเริ่มต้นสำหรับเดโม');
    expect(within(card).getByText('86.5 / 100')).toBeTruthy();
    expect(within(card).getByText('ข้อมูลไม่ครบ')).toBeTruthy();
    expect(within(card).getByText('ราคาไม่ตรง')).toBeTruthy();
    expect(within(card).getByText('ระยะเส้นตรง ไม่ใช่ระยะขับรถ')).toBeTruthy();
    expect(within(card).getByText(/ต้องสอบถาม\/ตรวจเพิ่ม: ความชื้นสูงสุด|ต้องสอบถาม\/ตรวจเพิ่ม: moisture_max_pct/)).toBeTruthy();
    expect(card.textContent).toContain('อุตรดิตถ์');
    expect(card.textContent).not.toMatch(/โทร|tel:|@|LINE/);
    const link = within(card).getByRole('link', { name: 'ดูรายละเอียด' });
    expect(link.getAttribute('href')).toBe('/matches/m1');
    expect(link.className).toContain('min-h-11');
  });

  it('hides a farmer name', () => {
    const m = match({ counterparty: { ...match().counterparty, display_name: null, org_kind: 'FARMER' } });
    render(<MatchCards items={[m]} />);
    expect(screen.getByText('เกษตรกร (ไม่เปิดเผยชื่อ)')).toBeTruthy();
  });
});

describe('MatchDetail', () => {
  it('shows reasons, component breakdown, missing data, disclaimer and the offer link', () => {
    render(<MatchDetail m={match()} />);
    expect(screen.getByText('ระยะเส้นตรง 12.3 กม. (ไม่ใช่ระยะขับรถ)')).toBeTruthy();
    expect(screen.getByTestId('weights-disclaimer').textContent).toContain('ค่าเริ่มต้นสำหรับทดสอบเดโม');
    const dist = document.querySelector('[data-component="distance"]') as HTMLElement;
    expect(dist.textContent).toContain('90%');
    expect(dist.textContent).toContain('น้ำหนัก 30%');
    expect((document.querySelector('[data-component="price"]') as HTMLElement).textContent).toContain('ไม่มีข้อมูล');
    expect(screen.getByTestId('missing-components').textContent).toContain('ราคา');
    expect(screen.getByTestId('no-contact-notice')).toBeTruthy();
    const offer = screen.getByRole('link', { name: 'เริ่มเสนอข้อตกลง' });
    expect(offer.getAttribute('href')).toBe('/offers/new?match_id=m1');
  });
});

describe('helpers and nav', () => {
  it('builds hrefs, finds matches and falls back to the raw field key', () => {
    expect(offerHref('a b')).toBe('/offers/new?match_id=a%20b');
    expect(findMatch([match()], 'zz')).toBeUndefined();
    expect(flagChipText({ code: 'NEEDS_CONFIRMATION', field: 'foo', label_th: '' })).toBe('ต้องสอบถาม/ตรวจเพิ่ม: foo');
  });

  it('marks /matches ready for factory and baler', () => {
    for (const role of ['FACTORY', 'BALER'] as const) {
      expect(navForRole(role).find((i) => i.href === '/matches')?.ready).toBe(true);
    }
  });
});
