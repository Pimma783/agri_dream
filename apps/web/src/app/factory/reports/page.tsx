import { agreementListSchema } from '@agrimatch/contracts';
import { ErrorNotice } from '@/components/feedback';
import { BarChart, Card, PageHead, Stat, td, th } from '@/components/factory/ui';
import { loadPageData, requireSession } from '@/lib/api-server';
import { fmtBaht, fmtNum, monthly, summarize, tonOf, valueOf } from '@/lib/factory-data';
import { OFFER_KIND_LABEL } from '@/lib/offers';

export default async function ReportsPage() {
  const me = await requireSession();
  const { data, error } = await loadPageData('/agreements', agreementListSchema);
  const s = summarize(data ?? [], me.org_id);
  const trend = monthly(s.bought, (a) => valueOf(a) / 1000);
  const kinds = (['PURCHASE', 'BALING_SERVICE'] as const).map((k) => {
    const xs = s.live.filter((a) => a.kind === k);
    return { k, n: xs.length, ton: xs.reduce((t, a) => t + tonOf(a.qty_kg), 0), value: xs.reduce((t, a) => t + valueOf(a), 0) };
  });
  const total = s.totalValue || 1;
  const counterparties = new Set(s.bought.map((a) => a.seller_org_id)).size;
  return (
    <>
      <PageHead title="รายงาน" sub="สรุปการซื้อวัสดุและข้อมูลเชิงวิเคราะห์ธุรกิจของคุณ" />
      {error ? <ErrorNotice error={error} /> : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="มูลค่าซื้อรวม" value={fmtBaht(s.boughtValue)} /><Stat label="ปริมาณวัสดุที่ซื้อ" value={fmtNum(s.boughtTon, 1)} unit="ตัน" />
        <Stat label="ข้อตกลงทั้งหมด" value={String(s.live.length)} unit="รายการ" /><Stat label="ผู้ขายที่ซื้อด้วย" value={String(counterparties)} unit="ราย" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><h2 className="font-semibold text-[#17402a]">แนวโน้มมูลค่าการซื้อ</h2><p className="mb-4 text-xs text-slate-500">หน่วย: พันบาท</p><BarChart labels={trend.labels} values={trend.values} height={190} /></Card>
        <Card><h2 className="mb-4 font-semibold text-[#17402a]">สัดส่วนมูลค่าตามประเภท</h2>
          {kinds.map((r) => { const pct = Math.round((r.value / total) * 1000) / 10; return (
            <div key={r.k} className="mb-4 text-sm"><div className="flex justify-between"><span>{OFFER_KIND_LABEL[r.k]}</span><b>{pct}%</b></div><div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-full rounded bg-[#1f6b43]" style={{ width: `${pct}%` }} /></div></div>); })}</Card>
      </div>
      <Card className="mt-4"><h2 className="mb-2 font-semibold text-[#17402a]">สรุปแยกตามประเภท</h2>
        <table className="w-full"><thead><tr><th className={th}>ประเภท</th><th className={th}>ข้อตกลง</th><th className={th}>ปริมาณ (ตัน)</th><th className={th}>มูลค่า (บาท)</th></tr></thead>
          <tbody>{kinds.map((r) => <tr key={r.k} className="border-t border-[#eef2ec]"><td className={td}>{OFFER_KIND_LABEL[r.k]}</td><td className={td}>{r.n}</td><td className={td}>{fmtNum(r.ton, 1)}</td><td className={td}>{fmtNum(r.value)}</td></tr>)}
            <tr className="border-t bg-[#eef4ea] font-semibold"><td className={td}>รวมทั้งหมด</td><td className={td}>{s.live.length}</td><td className={td}>{fmtNum(s.boughtTon + s.soldTon, 1)}</td><td className={td}>{fmtNum(s.totalValue)}</td></tr></tbody></table></Card>
    </>
  );
}
