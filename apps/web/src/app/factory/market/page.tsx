import Link from 'next/link';
import { matchListSchema } from '@agrimatch/contracts';
import { EmptyState, ErrorNotice } from '@/components/feedback';
import { Card, GREEN, PageHead } from '@/components/factory/ui';
import { loadPageData, requireSession } from '@/lib/api-server';
import { fmtNum, matchCard } from '@/lib/factory-data';
import { flagChipText, offerHref, scoreText, TIER_LABEL } from '@/lib/matches';

export default async function MarketPage() {
  await requireSession();
  const { data, error } = await loadPageData('/matches', matchListSchema);
  const items = data ?? [];
  return (
    <>
      <PageHead title="ตลาดวัสดุการเกษตร" sub="ผู้ขายที่ระบบจับคู่ให้ตามความต้องการรับซื้อของคุณ"
        action={<Link href="/demands/new" className={`rounded-lg px-4 py-2 text-sm ${GREEN}`}>+ ประกาศรับซื้อ</Link>} />
      {error ? <ErrorNotice error={error} /> : null}
      {data && items.length === 0 ? <EmptyState>ยังไม่มีผลจับคู่ ลองสร้างประกาศรับซื้อก่อน</EmptyState> : null}
      <p className="mb-3 text-sm text-slate-500">ผลจับคู่ทั้งหมด · {items.length} รายการ</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => {
          const c = matchCard(m);
          return (
            <Card key={m.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-[#17402a]">{c.title}</h3>
                <span className="rounded-full bg-[#dcebdc] px-2 py-0.5 text-xs">{scoreText(m.score)} คะแนน</span>
              </div>
              <p className="text-xs text-slate-500">{c.seller} · {c.province}</p>
              <p className="text-xs text-slate-400">{TIER_LABEL[m.tier]}{c.remainingTon !== null ? ` · คงเหลือ ${fmtNum(c.remainingTon, 1)} ตัน` : ''}{m.distance ? ` · ${fmtNum(Number(m.distance.km))} กม.` : ''}</p>
              {m.flags.length > 0 ? <p className="mt-2 text-xs text-amber-700">{m.flags.map(flagChipText).join(' · ')}</p> : null}
              <div className="mt-auto flex gap-2 pt-3">
                <Link href={`/matches/${m.id}`} className="rounded border border-[#e5eae3] px-3 py-1 text-xs">ดูรายละเอียด</Link>
                <Link href={offerHref(m.id)} className={`rounded px-3 py-1 text-xs ${GREEN}`}>ยื่นข้อเสนอ</Link>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
