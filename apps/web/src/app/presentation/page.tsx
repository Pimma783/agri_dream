import type { Metadata } from 'next';
import { PresentationDeck, type JudgeAccount } from '@/components/presentation/presentation-deck';
import { COPY, parseLang, parseSlide } from '@/lib/presentation-content';

// Public page: it sits outside the (app) layout, so there is no session check and no redirect to /login.
// Rendered per request so the judge account comes from the runtime environment, not from the build.
export const dynamic = 'force-dynamic';

type Search = { s?: string | string[]; lang?: string | string[] };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const copy = COPY[parseLang((await searchParams).lang)];
  return {
    title: copy.siteTitle,
    description: copy.description,
    // The judge account is shown on this page, so keep it out of search indexes.
    robots: { index: false, follow: false },
    openGraph: { title: copy.siteTitle, description: copy.description, type: 'website', siteName: 'AgriMatch' },
    twitter: { card: 'summary', title: copy.siteTitle, description: copy.description },
  };
}

/** Only the two judge variables are read. Both must be set, otherwise the page asks for an account. */
function readJudgeAccount(): JudgeAccount | null {
  const email = process.env.JUDGE_DEMO_EMAIL?.trim();
  const password = process.env.JUDGE_DEMO_PASSWORD;
  return email && password ? { email, password } : null;
}

export default async function PresentationPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { s, lang } = await searchParams;
  return <PresentationDeck lang={parseLang(lang)} slide={parseSlide(s)} judge={readJudgeAccount()} />;
}
