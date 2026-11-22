import type { Metadata } from 'next';
import { PitchDeck } from '@/components/presentation/pitch-deck';
import { PITCH_SITE, parsePitchSlide } from '@/lib/pitch-content';

// Public page, outside the (app) group: no session check. Pure static copy, nothing secret.
export const metadata: Metadata = {
  title: PITCH_SITE.title,
  description: PITCH_SITE.description,
  openGraph: { title: PITCH_SITE.title, description: PITCH_SITE.description, type: 'website', siteName: 'AgriMatch' },
};

export default async function PitchPage({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
  return <PitchDeck slide={parsePitchSlide((await searchParams).s)} />;
}
