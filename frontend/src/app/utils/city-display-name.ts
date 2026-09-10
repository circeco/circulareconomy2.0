/**
 * Title-case a cityId slug for display when no catalogue or cached name exists.
 * `stockholm` → `Stockholm`; `new-york` → `New York`.
 */
export function formatCityIdForDisplay(cityId: string): string {
  const slug = String(cityId || '').trim();
  if (!slug) return '';
  return slug
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * City label: catalogue name, then cached name, then a formatted cityId.
 */
export function resolveCityDisplayName(
  cityId: string,
  listName?: string | null,
  cachedName?: string | null
): string {
  const fromList = String(listName || '').trim();
  if (fromList) return fromList;
  const cached = String(cachedName || '').trim();
  if (cached) return cached;
  return formatCityIdForDisplay(cityId);
}
