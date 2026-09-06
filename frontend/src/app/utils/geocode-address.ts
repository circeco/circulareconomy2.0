import type { LatLng } from '../data/models';

/**
 * Resolve map coordinates from a place address via Nominatim.
 * Returns null when no usable hit is found.
 */
export async function geocodeAddress(args: {
  cityId: string;
  address: string;
  nameHint?: string;
  requestedWith?: string;
}): Promise<LatLng | null> {
  const address = String(args.address || '').trim();
  if (!address) return null;

  const cityLabel = String(args.cityId || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  const nameHint = String(args.nameHint || '').trim();
  const endpoint = 'https://nominatim.openstreetmap.org/search';
  const queries = [
    `${nameHint} ${address}, ${cityLabel}`.trim(),
    `${address}, ${cityLabel}`.trim(),
    address,
  ].filter(Boolean);

  try {
    for (const queryText of queries) {
      const qs = new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        addressdetails: '0',
        q: queryText,
      });
      const res = await fetch(`${endpoint}?${qs.toString()}`, {
        headers: {
          Accept: 'application/json',
          'X-Requested-With': args.requestedWith || 'circeco-admin',
        },
      });
      if (!res.ok) continue;
      const out = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = out[0];
      if (!hit) continue;
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      return { lat, lng };
    }
    return null;
  } catch (e) {
    console.warn('[geocode] failed', { cityId: args.cityId, address, nameHint, e });
    return null;
  }
}
