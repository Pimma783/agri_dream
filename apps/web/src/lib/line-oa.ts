import QRCode from 'qrcode';

// OA basic IDs. NEXT_PUBLIC_ values are inlined at build time; defaults work with no env.
export const FARMER_OA_ID = process.env.NEXT_PUBLIC_LINE_OA_FARMER?.trim() || '@642ctpqm';
export const FACTORY_OA_ID = process.env.NEXT_PUBLIC_LINE_OA_FACTORY?.trim() || '@241sxehz';

export function lineAddFriendUrl(oaId: string): string {
  return `https://line.me/R/ti/p/${oaId}`;
}

export interface QrGeometry {
  size: number;
  /** SVG path data: one square per dark module. */
  path: string;
}

/** Encodes locally (no network, no third-party service). */
export function qrGeometry(text: string): QrGeometry {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

export type LoginRole = 'farmer' | 'factory';

export function parseRole(value: string | string[] | undefined): LoginRole | null {
  return value === 'farmer' || value === 'factory' ? value : null;
}
