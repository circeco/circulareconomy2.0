export const ACTION_TAGS = [
  'refuse',
  'rethink',
  'reduce',
  'reuse',
  'repair',
  'refurbish',
  'remanufacture',
  'repurpose',
  'recycle',
  'share',
  'rental',
] as const;

export type ActionTag = (typeof ACTION_TAGS)[number];

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

  // common typos / variants we already saw in the project
  const normalized =
    raw === 'reporpouse' ? 'repurpose'
    : raw === 'remanifacture' ? 'remanufacture'
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

