// Camera path for the 3D scroll story (/story). Pure math so it can be tested without WebGL.
// Each section has a zone in the world along the X axis and a camera shot looking at it.
export type Vec3 = [number, number, number];
export interface Shot { pos: Vec3; look: Vec3 }

export const ZONE_GAP = 40;
export const zoneX = (i: number): number => i * ZONE_GAP;

/** One shot per section; angles alternate so each scroll step feels like a new camera move. */
const RAW: Shot[] = [
  { pos: [-14, 9, 20], look: [0, 2, 0] },          // 1 burning field, low and close
  { pos: [zoneX(1), 34, 26], look: [zoneX(1), 0, 0] },  // 2 scattered plots, high bird's-eye
  { pos: [zoneX(2) + 16, 10, 22], look: [zoneX(2), 3, 0] }, // 3 AI match, side angle
  { pos: [zoneX(3) - 4, 14, 30], look: [zoneX(3) + 4, 3, 0] }, // 4 supply chain, wide
  { pos: [zoneX(4), 26, 14], look: [zoneX(4), 0, 0] },  // 5 cycle, top-down tilt
  { pos: [zoneX(5) + 18, 7, 18], look: [zoneX(5), 4, 0] }, // 6 plant and trucks, low side
  { pos: [zoneX(6) - 10, 12, 22], look: [zoneX(6) + 2, 5, 0] }, // 7 formula columns
  { pos: [zoneX(7) + 6, 9, 16], look: [zoneX(7), 3, 0] },  // 8 money, close
  { pos: [zoneX(8) - 18, 16, 28], look: [zoneX(8) + 6, 2, 0] }, // 9 the road ahead, wide
];

/** Text cards sit left on even sections and right on odd ones, so frame the subject on the other side. */
const FRAME_SHIFT = 7;
export const SHOTS: Shot[] = RAW.map((s, i) => {
  const dx = i % 2 === 0 ? -FRAME_SHIFT : FRAME_SHIFT;
  return { pos: [s.pos[0] + dx, s.pos[1], s.pos[2]], look: [s.look[0] + dx, s.look[1], s.look[2]] };
});

export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Scroll position to story progress in [0, n-1] (section index plus fraction). */
export function progressFromScroll(scrollY: number, maxScroll: number, n = SHOTS.length): number {
  if (maxScroll <= 0) return 0;
  return Math.min(Math.max(scrollY / maxScroll, 0), 1) * (n - 1);
}

/** Camera at progress p: eased blend between neighbouring shots. */
export function cameraAt(p: number): Shot {
  const max = SHOTS.length - 1;
  const c = Math.min(Math.max(p, 0), max);
  const i = Math.min(Math.floor(c), max - 1);
  const t = smoothstep(c - i);
  const a = SHOTS[i]!, b = SHOTS[i + 1]!;
  return { pos: lerp3(a.pos, b.pos, t), look: lerp3(a.look, b.look, t) };
}

/** 1 when the story sits on section i, falling to 0 one section away. Used to grow and fade zone props. */
export const activeness = (p: number, i: number): number => Math.max(0, 1 - Math.abs(p - i));
