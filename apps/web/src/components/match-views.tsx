import Link from 'next/link';
import type { MatchView } from '@agrimatch/contracts';
import { BUTTON_CLASS, Card, CardList, Field } from '@/components/cards';
import { DemoWeightsLabel, EstimateLabel } from '@/components/labels';
import { PendingMaterial } from '@/components/pending-material';
import { formatDecimal, formatKg } from '@/lib/format';
import {
  COMPONENT_LABEL,
  counterpartyName,
  coverageText,
  DISTANCE_LABEL_TH,
  ENTITY_LABEL,
  flagChipText,
  fractionPct,
  NO_CONTACT_NOTICE,
  offerHref,
  scoreText,
  TIER_LABEL,
} from '@/lib/matches';

export function FlagChips({ flags }: { flags: MatchView['flags'] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="ข้อควรระวัง" className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <li
          key={`${f.code}:${f.field ?? ''}`}
          data-flag={f.code}
          className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900"
        >
          {flagChipText(f)}
        </li>
      ))}
    </ul>
  );
}

function TierBadge({ tier }: { tier: 0 | 1 }) {
  return (
    <span
      data-tier={tier}
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tier === 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Score with its two required labels: estimate, and default weights for the demo. */
export function ScoreBlock({ m }: { m: MatchView }) {
  const coverage = coverageText(m.weight_coverage);
  return (
    <div data-testid="match-score" className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">คะแนนความเหมาะสม</span>
        <EstimateLabel />
        <DemoWeightsLabel />
      </div>
      <p className="mt-1 text-lg font-semibold text-slate-900">{scoreText(m.score)} / 100</p>
      {coverage ? <p data-testid="weight-coverage" className="text-sm text-slate-700">คิดจากข้อมูล {coverage}</p> : null}
    </div>
  );
}

export function MatchCards({ items }: { items: MatchView[] }) {
  return (
    <CardList label="ผลจับคู่">
      {items.map((m) => (
        <Card key={m.id} title={counterpartyName(m.counterparty)} badge={<TierBadge tier={m.tier} />}>
          <p className="text-slate-600">
            {ENTITY_LABEL[m.counterparty.entity_type]} · {m.counterparty.province ?? 'ไม่ระบุจังหวัด'}
          </p>
          <ScoreBlock m={m} />
          {m.distance ? <p>{DISTANCE_LABEL_TH}: {m.distance.km} กม.</p> : null}
          <PendingMaterial data={m.counterparty.published} />
          <FlagChips flags={m.flags} />
          {m.reasons[0] ? <p>{m.reasons[0].text_th}</p> : null}
          <Link href={`/matches/${encodeURIComponent(m.id)}`} className={`${BUTTON_CLASS} w-full`}>
            ดูรายละเอียด
          </Link>
        </Card>
      ))}
    </CardList>
  );
}

function PublishedFields({ published }: { published: Record<string, unknown> }) {
  const rows: Array<[string, string]> = [];
  const qty = published.remaining_qty_kg ?? published.qty_kg ?? published.capacity_kg;
  if (typeof qty === 'string') rows.push(['ปริมาณ', formatKg(qty)]);
  const price = published.unit_price_thb ?? published.max_unit_price_thb;
  if (typeof price === 'string') rows.push(['ราคาที่ประกาศ', `${formatDecimal(price)} บาท/${published.price_unit === 'ton' || published.price_unit === 'TON' ? 'ตัน' : 'กก.'}`]);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(([k, v]) => (
        <Field key={k} label={k}>{v}</Field>
      ))}
    </>
  );
}

export function MatchDetail({ m }: { m: MatchView }) {
  const entries = Object.entries(m.components);
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="คู่ค้า">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 break-words text-base font-semibold">{counterpartyName(m.counterparty)}</h2>
          <TierBadge tier={m.tier} />
        </div>
        <dl className="space-y-2 text-sm">
          <Field label="ประเภท">{ENTITY_LABEL[m.counterparty.entity_type]}</Field>
          <Field label="จังหวัด">{m.counterparty.province ?? 'ไม่ระบุ'}</Field>
          <PublishedFields published={m.counterparty.published} />
          <PendingMaterial data={m.counterparty.published} />
          {m.distance ? <Field label={DISTANCE_LABEL_TH}>{m.distance.km} กม.</Field> : null}
        </dl>
        <p data-testid="no-contact-notice" className="text-xs text-slate-600">{NO_CONTACT_NOTICE}</p>
      </section>

      <ScoreBlock m={m} />
      <p data-testid="weights-disclaimer" className="text-xs text-slate-600">{m.weights_disclaimer_th}</p>
      <FlagChips flags={m.flags} />

      <section aria-label="เหตุผล" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">เหตุผล</h2>
        {m.reasons.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {m.reasons.map((r, i) => (
              <li key={`${r.code}:${i}`}>{r.text_th}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">ไม่มีเหตุผลที่บันทึกไว้</p>
        )}
      </section>

      <section aria-label="คะแนนแต่ละด้าน" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">คะแนนแต่ละด้าน</h2>
        <ul className="space-y-2 text-sm">
          {entries.map(([key, c]) => (
            <li key={key} data-component={key} className="flex flex-wrap justify-between gap-x-3">
              <span>{COMPONENT_LABEL[key] ?? key} <span className="text-xs text-slate-500">(น้ำหนัก {fractionPct(c.weight)})</span></span>
              <span className={c.value === null ? 'text-amber-800' : 'font-medium'}>{fractionPct(c.value)}</span>
            </li>
          ))}
        </ul>
        {m.missing_components.length ? (
          <p data-testid="missing-components" className="mt-2 text-xs text-amber-900">
            ไม่มีข้อมูล: {m.missing_components.map((k) => COMPONENT_LABEL[k] ?? k).join(', ')} (ไม่นำมาคิดคะแนน)
          </p>
        ) : null}
      </section>

      <Link href={offerHref(m.id)} className={`${BUTTON_CLASS} w-full`}>
        เริ่มเสนอข้อตกลง
      </Link>
    </div>
  );
}
