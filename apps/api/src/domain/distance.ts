// Pure layer. Straight-line (great-circle) distance, not driving distance (Requirement 9.7).

export const EARTH_RADIUS_KM = 6371.0088;

export interface Coordinates {
  lat: number;
  lng: number;
}

export function isValidCoordinates(c: Coordinates): boolean {
  return (
    Number.isFinite(c.lat) && Number.isFinite(c.lng) &&
    c.lat >= -90 && c.lat <= 90 && c.lng >= -180 && c.lng <= 180
  );
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Haversine distance in kilometres. Throws RangeError for out-of-range coordinates. */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  if (!isValidCoordinates(a) || !isValidCoordinates(b)) {
    throw new RangeError('haversineKm: coordinates out of range');
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(clamped));
}
