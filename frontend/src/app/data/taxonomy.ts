export const ACTION_TAGS = [
  'refuse',
  'reuse',
  'repair',
  'repurpose',
  'recycle',
  'reduce',
] as const;

export type ActionTag = (typeof ACTION_TAGS)[number];
export type SectorCategory = (typeof SECTOR_CATEGORIES)[number];

export const ACTION_TAG_LABELS: Record<ActionTag, string> = {
  refuse: 'Refuse',
  reuse: 'Reuse',
  repair: 'Repair',
  repurpose: 'Repurpose',
  recycle: 'Recycle',
  reduce: 'Reduce',
};

export const ACTION_TAG_COLORS: Record<ActionTag, string> = {
  refuse: '#0c343d',
  reuse: '#134f5c',
  repair: '#45818e',
  repurpose: '#76a5af',
  recycle: '#a2c4c9',
  reduce: '#d0e0e3',
};

export const SECTOR_CATEGORIES = [
  'apparel',
  'home-garden',
  'cycling-sports',
  'electronics',
  'books-comics-magazines',
  'music',
] as const;

export const SECTOR_CATEGORY_LABELS: Record<SectorCategory, string> = {
  apparel: 'Clothing & Accessories',
  'home-garden': 'Home & Garden',
  'cycling-sports': 'Cycling & Sports',
  electronics: 'Electronics',
  'books-comics-magazines': 'Books - Comics - Magazines',
  music: 'Music',
};

/**
 * Canonicalizes incoming tag strings to our controlled vocabulary.
 * This is intentionally tolerant because tags may come from:
 * - user input (admin/reviewer)
 * - ingestion pipelines
 * - historic UI copy (e.g. "Reporpouse")
 */
export function canonicalizeActionTag(input: string): ActionTag | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;

  // accepted aliases / historical values
  const normalized =
    raw === 'reporpouse' ? 'repurpose'
    : raw === 'rethink' ? 'refuse'
    : raw === 'refurbish' ? 'repair'
    : raw === 'remanufacture' ? 'repurpose'
    : raw === 'remanifacture' ? 'repurpose'
    : raw === 'share' ? 'reuse'
    : raw === 'rental' ? 'reuse'
    : raw;

  return (ACTION_TAGS as readonly string[]).includes(normalized) ? (normalized as ActionTag) : null;
}

export function canonicalizeActionTags(inputs: string[] | null | undefined): ActionTag[] {
  if (!Array.isArray(inputs)) return [];
  const out: ActionTag[] = [];
  for (const v of inputs) {
    const tag = canonicalizeActionTag(v);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function canonicalizeSectorCategory(input: string): SectorCategory | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/^shop:/, '')
    .replace(/^amenity:/, '')
    .replace(/^craft:/, '')
    .replace(/\s*&\s*/g, '-')
    .replace(/\s+/g, '-');

  if (normalized === 'apparel' || normalized === 'clothing' || normalized === 'accessories') return 'apparel';
  if (normalized === 'home-garden' || normalized === 'home' || normalized === 'furniture' || normalized === 'antiques') return 'home-garden';
  if (normalized === 'cycling-sports' || normalized === 'sport' || normalized === 'sports' || normalized === 'cycling') return 'cycling-sports';
  if (normalized === 'electronics') return 'electronics';
  if (normalized === 'books-comics-magazines' || normalized === 'books' || normalized === 'comics' || normalized === 'magazines') return 'books-comics-magazines';
  if (normalized === 'music') return 'music';
  return null;
}

export function canonicalizeSectorCategories(inputs: string[] | null | undefined): SectorCategory[] {
  if (!Array.isArray(inputs)) return [];
  const out: SectorCategory[] = [];
  for (const v of inputs) {
    const item = canonicalizeSectorCategory(v);
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

