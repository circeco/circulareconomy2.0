/**
 * Review-queue place address: `Street Number, CAP City` and nothing else.
 * No comma between street and number. Drops venue prefixes, country, extra commas.
 */

const CITY_DISPLAY_NAMES: Record<string, string> = {
  milan: 'Milano',
  milano: 'Milano',
  turin: 'Torino',
  torino: 'Torino',
  stockholm: 'Stockholm',
  uppsala: 'Uppsala',
  malmo: 'Malmö',
  goteborg: 'Göteborg',
  gothenburg: 'Göteborg',
  lund: 'Lund',
};

const COUNTRY_PART = /^(italy|italia|it|sweden|sverige|se)$/i;
const REGION_PART = /^(lombardia|lombardy|piemonte|piedmont|mi|to|va|mb|co)$/i;
const IT_CAP = /^\d{5}$/;
const SE_POST = /^\d{3}\s?\d{2}$/;
const HOUSE_NUMBER = /^\d+[a-zA-Z]?(?:[\/-][0-9a-zA-Z]+)?$/;
const HOUSE_NUMBER_AT_END = /^(.*?)(?:\s+)(\d+[a-zA-Z]?(?:[\/-][0-9a-zA-Z]+)?)$/;
const HOUSE_NUMBER_AT_START = /^(\d+[a-zA-Z]?(?:[\/-][0-9a-zA-Z]+)?)\s+(.+)$/;
const COORDS_ONLY = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;
const STREET_TYPE =
  /^(via|viale|piazza|piazzale|corso|largo|vicolo|alzaia|strada|galleria|lungo|corte|vico|riviera|passaggio|contrada|borgo|calata|salita|discesa|naviglio|gata|väg|vägen|torg|plan|street|road|avenue|lane)\b/i;
const SMALL_WORDS = new Set(['di', 'del', 'della', 'dello', 'dei', 'delle', 'da', 'al', 'alla', 'ai', 'e', 'de']);

function splitParts(raw: string): string[] {
  return raw
    .replace(/\s+/g, ' ')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function isPostal(part: string): boolean {
  const t = part.trim();
  return IT_CAP.test(t) || SE_POST.test(t);
}

function isHouseNumber(part: string): boolean {
  return HOUSE_NUMBER.test(part.trim());
}

function looksLikeStreet(part: string): boolean {
  const t = part.trim();
  if (!t) return false;
  if (STREET_TYPE.test(t)) return true;
  if (HOUSE_NUMBER_AT_END.test(t) && !isPostal(t)) return true;
  return false;
}

function extractPostalAndCityFromPart(part: string): { postal: string; city: string; rest: string } {
  const t = part.trim();
  const leading = t.match(/^(\d{5}|\d{3}\s?\d{2})\s+(.+)$/);
  if (leading) return { postal: leading[1].replace(/\s+/g, ' ').trim(), city: leading[2].trim(), rest: '' };
  const trailing = t.match(/^(.+?)\s+(\d{5}|\d{3}\s?\d{2})$/);
  if (trailing && !isHouseNumber(trailing[2])) {
    return { postal: trailing[2].replace(/\s+/g, ' ').trim(), city: trailing[1].trim(), rest: '' };
  }
  if (isPostal(t)) return { postal: t.replace(/\s+/g, ' ').trim(), city: '', rest: '' };
  return { postal: '', city: '', rest: t };
}

function splitStreetAndNumber(part: string): { street: string; number: string } {
  const t = part.trim();
  if (isHouseNumber(t)) return { street: '', number: t };
  const start = t.match(HOUSE_NUMBER_AT_START);
  if (start && STREET_TYPE.test(start[2])) {
    return { street: start[2].trim(), number: start[1] };
  }
  const end = t.match(HOUSE_NUMBER_AT_END);
  if (end && !isPostal(end[2])) {
    return { street: end[1].trim(), number: end[2] };
  }
  return { street: t, number: '' };
}

function titleStreet(street: string): string {
  const words = street.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ]\.$/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function canonicalCity(name: string, fallbackCityId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    const fromId = String(fallbackCityId || '').trim().toLowerCase();
    return CITY_DISPLAY_NAMES[fromId] || '';
  }
  const key = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CITY_DISPLAY_NAMES[key] || trimmed;
}

export function formatPlaceAddressDisplay(
  raw: string | undefined | null,
  fallbackCityId?: string
): string {
  const input = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!input) return '';
  if (COORDS_ONLY.test(input)) return input;

  const parts = splitParts(input).filter((p) => !COUNTRY_PART.test(p) && !REGION_PART.test(p));
  if (!parts.length) return '';

  let postal = '';
  let city = '';
  const leftover: string[] = [];

  for (const part of parts) {
    const extracted = extractPostalAndCityFromPart(part);
    if (extracted.postal && !postal) postal = extracted.postal;
    if (extracted.city && !city) city = extracted.city;
    if (extracted.rest) leftover.push(extracted.rest);
  }

  while (leftover.length > 1 && !looksLikeStreet(leftover[0]) && looksLikeStreet(leftover[1])) {
    leftover.shift();
  }

  let street = '';
  let number = '';
  const cityBits: string[] = [];

  for (const part of leftover) {
    if (isHouseNumber(part) && street && !number) {
      number = part;
      continue;
    }
    const split = splitStreetAndNumber(part);
    if (!street && (looksLikeStreet(part) || split.number || leftover.indexOf(part) === 0)) {
      street = split.street || street;
      if (split.number && !number) number = split.number;
      continue;
    }
    if (!city) cityBits.push(part);
    else cityBits.push(part);
  }

  if (!city && cityBits.length) {
    city = cityBits.join(' ').trim();
  }

  street = titleStreet(street);
  city = canonicalCity(city, fallbackCityId);

  const head = [street, number].filter(Boolean).join(' ').trim();
  const tail = [postal, city].filter(Boolean).join(' ').trim();
  if (head && tail) return `${head}, ${tail}`;
  return head || tail || input;
}
