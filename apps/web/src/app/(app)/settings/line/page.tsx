import { lineIdentitiesResponseSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice } from '@/components/feedback';
import { LineLinkPanel } from '@/components/line-link-panel';
import { LogoutButton } from '@/components/logout-button';
import { redirectIfExpired, requireSession, serverApi } from '@/lib/api-server';
import { CHANNEL_OF_ROLE } from '@/lib/line-link';

export const dynamic = 'force-dynamic';

export default async function LineSettingsPage() {
  const me = await requireSession();
  const channel = CHANNEL_OF_ROLE[me.role];
  let linked = false;
  let basicId: string | null = null;
  let failure: unknown = null;
  try {
    const status = await (await serverApi()).get('/line-identities', lineIdentitiesResponseSchema);
    const item = status.items.find((i) => i.channel === channel);
    linked = item?.status === 'LINKED';
    basicId = item?.basic_id ?? null;
  } catch (e) {
    try {
      await redirectIfExpired(e);
    } catch (r) {
      // redirect() throws a control-flow error that must propagate; other errors show a notice.
      if (r === e) failure = e;
      else throw r;
    }
  }
  return (
    <div className="space-y-4">
      <PageTitle>ตั้งค่า LINE</PageTitle>
      {failure ? <ErrorNotice error={failure} /> : null}
      <LineLinkPanel channel={channel} linked={linked} basicId={basicId} />
      <LogoutButton />
    </div>
  );
}
