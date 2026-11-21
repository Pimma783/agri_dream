import { PageTitle } from '@/components/cards';
import { Notice } from '@/components/feedback';
import { ServiceForm } from '@/components/posting-form';
import { requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function NewServicePage() {
  const me = await requireSession();
  if (me.role !== 'BALER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางเท่านั้น</Notice>;
  return (
    <div className="space-y-4">
      <PageTitle>สร้างบริการรับจ้างอัด</PageTitle>
      <ServiceForm />
    </div>
  );
}
