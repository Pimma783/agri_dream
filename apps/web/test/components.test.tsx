// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OFFER_STATUSES, POSTING_STATUSES, AGREEMENT_STATUSES, IMAGE_ASSESSMENT_STATUSES } from '@agrimatch/contracts';
import {
  DemoWeightsLabel, EstimateLabel, EstimateValue, ImageAssessmentDisclaimer, QuotedValue,
} from '@/components/labels';
import { ErrorNotice, Notice, STATUS_BADGES, StatusBadge } from '@/components/feedback';
import { Card, CardList, Field } from '@/components/cards';
import { AppShell } from '@/components/app-shell';
import { ApiRequestError } from '@/lib/api-core';
import { isActive, navForRole } from '@/lib/nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
afterEach(cleanup);

describe('labels', () => {
  it('uses the required Thai texts', () => {
    render(<><EstimateLabel /><DemoWeightsLabel /><ImageAssessmentDisclaimer /></>);
    expect(screen.getByText('ประมาณการ')).toBeTruthy();
    expect(screen.getByText('ค่าเริ่มต้นสำหรับเดโม')).toBeTruthy();
    expect(screen.getByText('การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง')).toBeTruthy();
  });
  it('keeps estimates visually separate from quoted prices', () => {
    render(<><EstimateValue label="รายได้">1</EstimateValue><QuotedValue label="ราคา">2</QuotedValue></>);
    const est = screen.getByTestId('estimate-value');
    const quote = screen.getByTestId('quoted-value');
    expect(est.className).toContain('border-dashed');
    expect(quote.className).not.toContain('border-dashed');
    expect(est.textContent).toContain('ประมาณการ');
    expect(quote.textContent).not.toContain('ประมาณการ');
  });
});

describe('feedback', () => {
  it('has a badge for every status in contracts', () => {
    for (const s of [...OFFER_STATUSES, ...POSTING_STATUSES, ...AGREEMENT_STATUSES, ...IMAGE_ASSESSMENT_STATUSES]) {
      expect(STATUS_BADGES[s].label.length).toBeGreaterThan(0);
    }
    render(<StatusBadge status="PENDING" />);
    expect(screen.getByText('รอตอบรับ')).toBeTruthy();
  });
  it('renders notices and API error messages as alerts', () => {
    render(<><Notice title="หัวข้อ">เนื้อหา</Notice><ErrorNotice error={new ApiRequestError(409, 'STALE_VERSION', 'ข้อมูลเก่า')} /></>);
    expect(screen.getByRole('alert').textContent).toBe('ข้อมูลเก่า');
    expect(screen.getByText('หัวข้อ')).toBeTruthy();
  });
});

describe('cards and shell', () => {
  it('renders a card list instead of a table', () => {
    render(<CardList label="รายการ"><Card title="A" badge={<StatusBadge status="OK" />}><dl><Field label="ปริมาณ">5</Field></dl></Card></CardList>);
    expect(screen.getByRole('list', { name: 'รายการ' })).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });
  it('shows role-aware nav with unready items disabled and min 44px targets', () => {
    expect(navForRole('FARMER').map((i) => i.href)).not.toContain('/demands');
    expect(navForRole('FACTORY').map((i) => i.href)).toContain('/demands');
    expect(isActive('/offers', '/offers/1')).toBe(true);
    expect(isActive('/', '/offers')).toBe(false);
    render(<AppShell me={{ org_name: 'ฟาร์ม', role: 'FARMER' }}>เนื้อหา</AppShell>);
    expect(screen.getByTestId('org-line').textContent).toContain('เกษตรกร');
    const home = screen.getByText('หน้าหลัก').closest('a')!;
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(home.className).toContain('min-h-14');
    expect(screen.getByText('ประกาศขาย').closest('[aria-disabled="true"]')).toBeTruthy();
  });
});
