import type { Metadata } from 'next';
import { StoryPage } from '@/components/presentation/story-page';
import { PITCH_SITE } from '@/lib/pitch-content';

// Public 3D scroll version of the pitch. No session check, static copy only.
export const metadata: Metadata = {
  title: `${PITCH_SITE.title} (3D)`,
  description: PITCH_SITE.description,
};

export default function Story() {
  return <StoryPage />;
}
