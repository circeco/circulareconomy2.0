/**
 * User-facing link text for place/event websites.
 * Prefer an explicit label when set; otherwise show a short host like `www.example.com/`.
 */
export function websiteDisplayLabel(
  url: string | undefined | null,
  label?: string | undefined | null
): string {
  const custom = String(label || '').trim();
  if (custom) return custom;

  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    let host = parsed.hostname.toLowerCase();
    if (!host.startsWith('www.')) host = `www.${host}`;
    return `${host}/`;
  } catch {
    const host = raw
      .replace(/^https?:\/\//i, '')
      .replace(/^\/\//, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
    if (!host) return raw;
    return `${host.startsWith('www.') ? host : `www.${host}`}/`;
  }
}
