/**
 * OSM place-discovery clause catalog and city/global overlays.
 * Keep DEFAULT_OSM_CLAUSES in sync with tools/lib/osm-discovery-queries.js
 */

export const OSM_CLAUSE_KEYS = ['shop', 'amenity', 'craft'] as const;
export type OsmClauseKey = (typeof OSM_CLAUSE_KEYS)[number];
export type OsmClauseKind = 'tag' | 'name_regex' | 'and_tag';
export type OsmClauseGroup = 'shops' | 'amenities';

export const OSM_GLOBAL_SCOPE = '__global__';
export const OSM_CLAUSE_PENALTY_CAP = 0.14;

export type OsmClause = {
  id: string;
  group: OsmClauseGroup;
  kind: OsmClauseKind;
  key: OsmClauseKey;
  value?: string;
  pattern?: string;
  andKey?: string;
  andValue?: string;
  label: string;
  builtin: boolean;
};

export type OsmQueryOverlay = {
  disabledClauseIds: string[];
  reenabledClauseIds: string[];
  removedClauseIds: string[];
  extraClauses: OsmClause[];
  clausePenalties: Record<string, number>;
};

export type OsmQuerySuggestion = {
  id: string;
  support: number;
  approvalRate?: number;
  action: 'disable' | 'add';
  kind?: OsmClauseKind;
  key?: OsmClauseKey;
  value?: string;
};

const TAG_VALUE_RE = /^[a-z0-9_]{1,40}$/;
const NAME_PATTERN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const OSM_AND_KEYS = ['second_hand', 'vintage', 'rental', 'repair'] as const;
export type OsmAndKey = (typeof OSM_AND_KEYS)[number];

export const OSM_AND_SHOP_VALUES = [
  'antiques',
  'bicycle',
  'books',
  'clothes',
  'computer',
  'electronics',
  'furniture',
  'houseware',
  'interior_decoration',
  'jewelry',
  'music',
  'shoes',
  'sports',
  'toys',
  'variety_store',
  'vintage',
  'watches',
] as const;
export type OsmAndShopValue = (typeof OSM_AND_SHOP_VALUES)[number];

export const OSM_AND_KEY_LABELS: Record<OsmAndKey, string> = {
  second_hand: 'second_hand=yes (used goods)',
  vintage: 'vintage=yes',
  rental: 'rental=yes',
  repair: 'repair=yes',
};

function isOsmAndKey(value: string): value is OsmAndKey {
  return (OSM_AND_KEYS as readonly string[]).includes(value);
}

function andClauseId(key: OsmClauseKey, value: string, andKey: string, andValue: string): string {
  return andValue === 'yes' ? `${key}:${value}+${andKey}` : `${key}:${value}+${andKey}:${andValue}`;
}

function andClause(value: string, andKey: OsmAndKey, andValue = 'yes'): OsmClause {
  return {
    id: andClauseId('shop', value, andKey, andValue),
    group: 'shops',
    kind: 'and_tag',
    key: 'shop',
    value,
    andKey,
    andValue,
    label: `shop=${value} and ${andKey}=${andValue}`,
    builtin: true,
  };
}

const SECOND_HAND_SHOPS = OSM_AND_SHOP_VALUES.filter((v) => v !== 'antiques' && v !== 'vintage');

export const DEFAULT_OSM_CLAUSES: OsmClause[] = [
  { id: 'shop:second_hand', group: 'shops', kind: 'tag', key: 'shop', value: 'second_hand', label: 'shop=second_hand', builtin: true },
  { id: 'shop:charity', group: 'shops', kind: 'tag', key: 'shop', value: 'charity', label: 'shop=charity', builtin: true },
  { id: 'shop:rental', group: 'shops', kind: 'tag', key: 'shop', value: 'rental', label: 'shop=rental', builtin: true },
  { id: 'shop:vintage', group: 'shops', kind: 'tag', key: 'shop', value: 'vintage', label: 'shop=vintage', builtin: true },
  { id: 'shop:antiques', group: 'shops', kind: 'tag', key: 'shop', value: 'antiques', label: 'shop=antiques', builtin: true },
  { id: 'name:vintage', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'vintage', label: 'shop name contains “vintage”', builtin: true },
  { id: 'name:humana', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'humana', label: 'shop name contains “humana”', builtin: true },
  { id: 'name:libraccio', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'libraccio', label: 'shop name contains “libraccio”', builtin: true },
  ...SECOND_HAND_SHOPS.map((value) => andClause(value, 'second_hand')),
  ...(['clothes', 'furniture', 'jewelry', 'music'] as const).map((value) => andClause(value, 'vintage')),
  ...(['bicycle', 'sports'] as const).map((value) => andClause(value, 'rental')),
  ...(['bicycle', 'computer', 'electronics'] as const).map((value) => andClause(value, 'repair')),
  { id: 'amenity:recycling', group: 'amenities', kind: 'tag', key: 'amenity', value: 'recycling', label: 'amenity=recycling', builtin: true },
  { id: 'amenity:recycling_centre', group: 'amenities', kind: 'tag', key: 'amenity', value: 'recycling_centre', label: 'amenity=recycling_centre', builtin: true },
];

function isOsmClauseKey(value: string): value is OsmClauseKey {
  return (OSM_CLAUSE_KEYS as readonly string[]).includes(value);
}

function uniqStrings(values: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(values) ? values : []) {
    const s = String(v || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function clauseIdFor(kind: OsmClauseKind, key: OsmClauseKey, token: string): string {
  const t = token.toLowerCase();
  return kind === 'name_regex' ? `name:${t}` : `${key}:${t}`;
}

function groupForKey(key: OsmClauseKey): OsmClauseGroup {
  return key === 'amenity' ? 'amenities' : 'shops';
}

function clauseLabel(clause: Pick<OsmClause, 'kind' | 'key' | 'value' | 'pattern' | 'andKey' | 'andValue'>): string {
  switch (clause.kind) {
    case 'name_regex':
      return `${clause.key} name contains “${clause.pattern}”`;
    case 'and_tag':
      return `${clause.key}=${clause.value} and ${clause.andKey}=${clause.andValue}`;
    case 'tag':
      return `${clause.key}=${clause.value}`;
    default: {
      const _never: never = clause.kind;
      return String(_never);
    }
  }
}

export function normalizeOsmClause(raw: unknown, builtin = false): OsmClause | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kindRaw = String(row['kind'] || 'tag').trim();
  const key = String(row['key'] || '').trim().toLowerCase();
  if (!isOsmClauseKey(key)) return null;
  if (kindRaw === 'tag') {
    const value = String(row['value'] || '').trim().toLowerCase();
    if (!TAG_VALUE_RE.test(value)) return null;
    const id = String(row['id'] || clauseIdFor('tag', key, value)).trim() || clauseIdFor('tag', key, value);
    return {
      id,
      group: groupForKey(key),
      kind: 'tag',
      key,
      value,
      label: String(row['label'] || clauseLabel({ kind: 'tag', key, value })),
      builtin,
    };
  }
  if (kindRaw === 'name_regex') {
    const pattern = String(row['pattern'] || row['value'] || '').trim().toLowerCase();
    if (!NAME_PATTERN_RE.test(pattern)) return null;
    const id = String(row['id'] || clauseIdFor('name_regex', key, pattern)).trim()
      || clauseIdFor('name_regex', key, pattern);
    return {
      id,
      group: groupForKey(key),
      kind: 'name_regex',
      key,
      pattern,
      label: String(row['label'] || clauseLabel({ kind: 'name_regex', key, pattern })),
      builtin,
    };
  }
  if (kindRaw === 'and_tag') {
    const value = String(row['value'] || '').trim().toLowerCase();
    const andKey = String(row['andKey'] || '').trim().toLowerCase();
    const andValue = String(row['andValue'] || '').trim().toLowerCase();
    if (!TAG_VALUE_RE.test(value) || !isOsmAndKey(andKey) || !TAG_VALUE_RE.test(andValue)) {
      return null;
    }
    const id = String(row['id'] || andClauseId(key, value, andKey, andValue)).trim()
      || andClauseId(key, value, andKey, andValue);
    return {
      id,
      group: groupForKey(key),
      kind: 'and_tag',
      key,
      value,
      andKey,
      andValue,
      label: String(row['label'] || clauseLabel({ kind: 'and_tag', key, value, andKey, andValue })),
      builtin,
    };
  }
  return null;
}

function parsePenaltyMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (!id || !Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(OSM_CLAUSE_PENALTY_CAP, n);
  }
  return out;
}

export function parseOsmQueryOverlay(raw: unknown): OsmQueryOverlay {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const extraClauses: OsmClause[] = [];
  for (const row of Array.isArray(src['extraClauses']) ? src['extraClauses'] : []) {
    const clause = normalizeOsmClause(row, false);
    if (clause) extraClauses.push(clause);
  }
  return {
    disabledClauseIds: uniqStrings(src['disabledClauseIds']),
    reenabledClauseIds: uniqStrings(src['reenabledClauseIds']),
    removedClauseIds: uniqStrings(src['removedClauseIds']),
    extraClauses,
    clausePenalties: parsePenaltyMap(src['clausePenalties']),
  };
}

export function overlayFromCityDiscovery(discovery: unknown): OsmQueryOverlay {
  const d = discovery && typeof discovery === 'object' ? (discovery as Record<string, unknown>) : {};
  const queries = d['osmQueries'] && typeof d['osmQueries'] === 'object'
    ? (d['osmQueries'] as Record<string, unknown>)
    : {};
  return parseOsmQueryOverlay({
    disabledClauseIds: queries['disabledClauseIds'] || d['osmDisabledClauseIds'],
    reenabledClauseIds: queries['reenabledClauseIds'] || d['osmReenabledClauseIds'],
    removedClauseIds: queries['removedClauseIds'] || d['osmRemovedClauseIds'],
    extraClauses: queries['extraClauses'] || d['osmExtraClauses'],
    clausePenalties: d['osmClausePenalties'] || queries['clausePenalties'],
  });
}

export type ResolvedOsmClauses = {
  enabled: OsmClause[];
  catalog: OsmClause[];
  disabledIds: string[];
  penalties: Record<string, number>;
};

export function resolveOsmClauses(
  globalOverlay: unknown,
  cityOverlay: unknown
): ResolvedOsmClauses {
  const global = parseOsmQueryOverlay(globalOverlay);
  const city = parseOsmQueryOverlay(cityOverlay);
  const disabled = new Set(global.disabledClauseIds);
  for (const id of city.reenabledClauseIds) disabled.delete(id);
  for (const id of city.disabledClauseIds) disabled.add(id);
  const removed = new Set(global.removedClauseIds);
  for (const id of city.removedClauseIds) removed.add(id);

  const byId = new Map<string, OsmClause>();
  for (const c of DEFAULT_OSM_CLAUSES) byId.set(c.id, { ...c });
  for (const c of global.extraClauses) byId.set(c.id, { ...c, builtin: false });
  for (const c of city.extraClauses) byId.set(c.id, { ...c, builtin: false });

  const catalog = [...byId.values()].filter((c) => !removed.has(c.id));
  return {
    enabled: catalog.filter((c) => !disabled.has(c.id)),
    catalog,
    disabledIds: [...disabled],
    penalties: { ...global.clausePenalties, ...city.clausePenalties },
  };
}

export function parseOsmQuerySuggestions(raw: unknown): {
  remove: OsmQuerySuggestion[];
  add: OsmQuerySuggestion[];
  period: string;
} {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mapRow = (row: unknown, action: OsmQuerySuggestion['action']): OsmQuerySuggestion | null => {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const id = String(r['id'] || '').trim();
    if (!id) return null;
    const keyRaw = String(r['key'] || '').trim().toLowerCase();
    const key = isOsmClauseKey(keyRaw) ? keyRaw : undefined;
    const kindRaw = String(r['kind'] || (action === 'add' ? 'tag' : '')).trim();
    const kind: OsmClauseKind | undefined =
      kindRaw === 'tag' || kindRaw === 'name_regex' || kindRaw === 'and_tag' ? kindRaw : undefined;
    return {
      id,
      support: Number(r['support'] || 0) || 0,
      approvalRate: Number.isFinite(Number(r['approvalRate'])) ? Number(r['approvalRate']) : undefined,
      action,
      kind,
      key,
      value: r['value'] != null ? String(r['value']) : undefined,
    };
  };
  return {
    period: String(src['period'] || '').trim(),
    remove: (Array.isArray(src['remove']) ? src['remove'] : [])
      .map((row) => mapRow(row, 'disable'))
      .filter((row): row is OsmQuerySuggestion => !!row),
    add: (Array.isArray(src['add']) ? src['add'] : [])
      .map((row) => mapRow(row, 'add'))
      .filter((row): row is OsmQuerySuggestion => !!row),
  };
}

export type OsmClauseStat = {
  id: string;
  reviewed: number;
  approved: number;
  rejected: number;
  approvalRate: number;
};

export function currentLearningPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousLearningPeriod(period: string): string {
  const [year, month] = period.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return currentLearningPeriod();
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function clausesFromQueueRow(row: unknown): string[] {
  const doc = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const candidate = doc['candidate'] && typeof doc['candidate'] === 'object'
    ? (doc['candidate'] as Record<string, unknown>)
    : {};
  const stored = uniqStrings([
    ...(Array.isArray(doc['osmClauses']) ? doc['osmClauses'] : []),
    ...(Array.isArray(candidate['osmClauses']) ? candidate['osmClauses'] : []),
  ]);
  if (stored.length) return stored;
  const evidence = Array.isArray(doc['evidence']) ? doc['evidence'] : [];
  const snippet = String((evidence[0] && typeof evidence[0] === 'object'
    ? (evidence[0] as Record<string, unknown>)['snippet']
    : '') || '');
  const out: string[] = [];
  const shop = snippet.match(/shop=([a-z0-9_]+)/i);
  if (shop) out.push(`shop:${shop[1].toLowerCase()}`);
  const amenity = snippet.match(/amenity=([a-z0-9_]+)/i);
  if (amenity) out.push(`amenity:${amenity[1].toLowerCase()}`);
  const craft = snippet.match(/craft=([a-z0-9_]+)/i);
  if (craft) out.push(`craft:${craft[1].toLowerCase()}`);
  return uniqStrings(out);
}

export function parseOsmClauseStats(raw: unknown): OsmClauseStat[] {
  if (!Array.isArray(raw)) return [];
  const out: OsmClauseStat[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r['id'] || r['key'] || '').replace(/^osm:/, '').trim();
    if (!id) continue;
    const reviewed = Number(r['reviewed'] || r['support'] || 0) || 0;
    const approved = Number(r['approved'] || 0) || 0;
    const rejected = Number(r['rejected'] || 0) || 0;
    const approvalRate = Number.isFinite(Number(r['approvalRate']))
      ? Number(r['approvalRate'])
      : reviewed
        ? approved / reviewed
        : 0;
    out.push({ id, reviewed, approved, rejected, approvalRate });
  }
  return out.sort((a, b) => b.reviewed - a.reviewed || a.id.localeCompare(b.id));
}

export function queuePlaceName(row: unknown): string {
  const doc = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const candidate = doc['candidate'] && typeof doc['candidate'] === 'object'
    ? (doc['candidate'] as Record<string, unknown>)
    : {};
  return String(candidate['name'] || doc['id'] || '(missing name)').trim() || '(missing name)';
}

export const OSM_LOCAL_RADIUS_M = 9000;
export const OSM_MONTHLY_RADIUS_M = 6000;
export const OSM_RADIUS_KM_OPTIONS = [3, 6, 9, 12, 15] as const;

export function radiusMFromKm(km: number): number {
  const n = Math.round(Number(km) || 0);
  return Math.max(1000, n * 1000);
}

export function radiusKmFromM(meters: number): number {
  const n = Number(meters);
  if (!Number.isFinite(n) || n <= 0) return OSM_LOCAL_RADIUS_M / 1000;
  return Math.round(n / 1000);
}

export type ClauseYield = { fetched: number; queued: number };

export type LastPlaceRun = {
  at: string;
  status: string;
  radiusM: number;
  effectiveRadiusM: number;
  limit: number;
  fetchedCount: number;
  queuedCount: number;
  skippedReviewedQueue: number;
  skippedMemoryHard: number;
  skippedMemorySoft: number;
  skippedApproved: number;
  catalogueCount: number;
  clauseYield: Record<string, ClauseYield>;
  errorSummary: string;
};

export type LastEventRun = {
  at: string;
  status: string;
  fetchedCount: number;
  queuedCount: number;
  skippedNotCircular: number;
  skippedPast: number;
  skippedApproved: number;
};

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseClauseYield(raw: unknown): Record<string, ClauseYield> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ClauseYield> = {};
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    out[id] = { fetched: num(r['fetched']), queued: num(r['queued']) };
  }
  return out;
}

export function parseLastPlaceRun(raw: unknown): LastPlaceRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const at = String(r['at'] || r['startedAt'] || r['finishedAt'] || '').trim();
  if (!at) return null;
  return {
    at,
    status: String(r['status'] || '').trim() || 'unknown',
    radiusM: num(r['radiusM']),
    effectiveRadiusM: num(r['effectiveRadiusM']) || num(r['radiusM']),
    limit: num(r['limit']),
    fetchedCount: num(r['fetchedCount']),
    queuedCount: num(r['queuedCount']),
    skippedReviewedQueue: num(r['skippedReviewedQueue']),
    skippedMemoryHard: num(r['skippedMemoryHard']),
    skippedMemorySoft: num(r['skippedMemorySoft']),
    skippedApproved: num(r['skippedApproved']),
    catalogueCount: num(r['catalogueCount']),
    clauseYield: parseClauseYield(r['clauseYield']),
    errorSummary: String(r['errorSummary'] || '').trim(),
  };
}

export function parseLastEventRun(raw: unknown): LastEventRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const at = String(r['at'] || r['startedAt'] || r['finishedAt'] || '').trim();
  if (!at) return null;
  return {
    at,
    status: String(r['status'] || '').trim() || 'unknown',
    fetchedCount: num(r['fetchedCount']),
    queuedCount: num(r['queuedCount']),
    skippedNotCircular: num(r['skippedNotCircular']),
    skippedPast: num(r['skippedPast']),
    skippedApproved: num(r['skippedApproved']),
  };
}
