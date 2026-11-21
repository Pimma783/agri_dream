import { Notice } from '@/components/feedback';
import { PageTitle } from '@/components/cards';
import { requireSession } from '@/lib/api-server';
import { ROLE_LABEL_TH } from '@/lib/nav';

// Minimal shell. Real dashboard content arrives with tasks 11.2-11.5.
export default async function HomePage() {
  const me = await requireSession();
  return (
    <>
      <PageTitle>หน้าหลัก</PageTitle>
      <Notice title={`${me.org_name} (${ROLE_LABEL_TH[me.role]})`}>เมนูอื่นจะเปิดให้ใช้เมื่อหน้านั้นพร้อม</Notice>
    </>
  );
}
