/**
 * Event search queries, seed URLs, and city/global overlays.
 * Keep DEFAULT_EVENT_SEARCH_QUERIES / DEFAULT_EVENT_SEED_URLS in sync with
 * tools/lib/event-discovery-queries.js
 */

import type { ClauseYield, OsmClauseStat, OsmQuerySuggestion } from './osm-discovery-queries';
import { parseClauseYield } from './osm-discovery-queries';

export const EVENT_GLOBAL_SCOPE = '__global__';
export const EVENT_QUERY_PENALTY_CAP = 0.14;
const MAX_QUERY_LEN = 80;
const MAX_SEED_LEN = 240;

export type EventQueryItem = {
  id: string;
  label: string;
  builtin: boolean;
};

export type EventQueryOverlay = {
  extraQueries: string[];
  disabledQueries: string[];
  reenabledQueries: string[];
  removedQueries: string[];
  extraSeeds: string[];
  disabledSeeds: string[];
  reenabledSeeds: string[];
  removedSeeds: string[];
  extraBlockDomains: string[];
  disabledBlockDomains: string[];
  reenabledBlockDomains: string[];
  removedBlockDomains: string[];
  queryPenalties: Record<string, number>;
};

export type EventQuerySuggestion = OsmQuerySuggestion;
export type EventQueryStat = OsmClauseStat;

export const DEFAULT_EVENT_SEARCH_QUERIES: Record<string, string[]> = {
  milan: [
    'repair cafe Milano',
    'mercatino dell usato Milano',
    'mercatone antiquariato Navigli 2026',
    'swap party Milano',
    'economia circolare evento Milano',
    'laboratorio di riparazione Milano evento',
    'zero waste Milano evento',
    'baratto Milano evento',
    'vintage market Milano',
  ],
  stockholm: [
    'repair cafe Stockholm',
    'repair café Stockholm',
    'loppis Stockholm evenemang',
    'bakluckeloppis Stockholm',
    'återbruk evenemang Stockholm',
    'lappa laga Stockholm',
    'circular economy event Stockholm',
    'fixit clinic Stockholm',
  ],
  turin: [
    'repair cafe Torino',
    'mercatino dell usato Torino',
    'swap party Torino',
    'economia circolare evento Torino',
  ],
  uppsala: [
    'repair cafe Uppsala',
    'loppis Uppsala evenemang',
    'återbruk Uppsala',
    'bytfest Uppsala',
  ],
  malmo: [
    'repair cafe Malmö',
    'repair café Malmö',
    'loppis Malmö evenemang',
    'återbruk Malmö',
    'bytfest Malmö',
    'circular economy event Malmö',
  ],
  goteborg: [
    'repair cafe Göteborg',
    'repair café Göteborg',
    'loppis Göteborg evenemang',
    'återbruk Göteborg',
    'bytfest Göteborg',
    'circular economy event Gothenburg',
  ],
  lund: [
    'repair cafe Lund',
    'loppis Lund evenemang',
    'återbruk Lund',
    'bytfest Lund',
  ],
};

export const DEFAULT_EVENT_SEED_URLS: Record<string, string[]> = {
  milan: [
    'https://labbaronarepaircafe.com/',
    'https://www.milanofree.it/milano/eventi/mercatone-dellantiquariato-sui-navigli-calendario-2026-orari-e-come-arrivare.html',
    'https://www.pulcienonsolo.it/',
    'https://swapinthecitymilano.it/',
    'https://www.stayhappening.com/s/riparazione-milano',
    'https://wundermrkt.com/',
    'https://wundermrkt.com/tutti-gli-eventi/',
    'https://remiramarket.com/events',
    'https://www.bovisattiva.org/events/mercatini-vintage-in-bovisa-e-dergano',
    'https://scripomarket.com/evento/il-mercatino-di-via-armorari-cordusio-milano-4/',
    'https://www.vibeevents.it/mercatini-milano/',
  ],
  stockholm: [
    'https://somo.social/sv/e/bakluckeloppis-i-vartahamnen-905',
    'https://www.stayhappening.com/e/l%C3%A5t-oss-lappa-stoppa-och-laga-E2ISYP28AF2',
    'https://biblioteket.stockholm.se/evenemang/repair-share-cafe-smycka-och-utforska-1',
    'https://stockholm.naturskyddsforeningen.se/2026/05/13/cafe-repet-lappa-laga-3/',
    'https://loppiskartan.se/loppiskalender',
  ],
  turin: ['https://www.repaircafe.org/en/visit/'],
  uppsala: ['https://www.repaircafe.org/en/visit/'],
  malmo: ['https://www.repaircafe.org/en/visit/'],
  goteborg: ['https://www.repaircafe.org/en/visit/'],
  lund: ['https://www.repaircafe.org/en/visit/'],
};

export const DEFAULT_EVENT_BLOCK_DOMAINS = [
  'milanopocket.it',
  'ticketone.it',
  'ticketmaster.it',
  'ticketmaster.se',
  'ticketmaster.com',
  'eventbrite.com',
  'eventbrite.it',
  'eventbrite.se',
  'yelp.com',
  'tripadvisor.com',
  'tripadvisor.it',
  'facebook.com',
  'instagram.com',
  'meetup.com',
] as const;

export const EVENT_POST_FILTER_NOTES = [
  'Title must look circular (repair, swap, loppis, reuse, …). Search-query words are not used as fake proof.',
  'Hosts on the block list are skipped.',
  'Upcoming only unless a run asks otherwise (weekly job uses maxPastDays=0).',
  'Geography must match the selected city.',
] as const;

function uniqStrings(values: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(values) ? values : []) {
    const s = String(v || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function parsePenaltyMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (!id || !Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(EVENT_QUERY_PENALTY_CAP, n);
  }
  return out;
}

export function normalizeEventQuery(raw: unknown): string {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > MAX_QUERY_LEN) return '';
  return s;
}

export function normalizeSeedUrl(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s) || s.length > MAX_SEED_LEN) return '';
  return s;
}

export function seedQueryId(url: unknown): string {
  const normalized = normalizeSeedUrl(url) || String(url || '').trim();
  return normalized ? `seed:${normalized}` : '';
}

export function asSeedQueryId(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.toLowerCase().startsWith('seed:')) return seedQueryId(s.slice(5));
  return seedQueryId(s);
}

export function eventQueryLabel(id: string): string {
  const s = String(id || '').trim();
  if (s.toLowerCase().startsWith('seed:')) return s.slice(5);
  return s;
}

export function normalizeBlockDomain(raw: unknown): string {
  return String(raw || '').trim().toLowerCase().replace(/^www\./, '');
}

function catalogItem(id: string, defaults: string[]): EventQueryItem {
  return { id, label: eventQueryLabel(id), builtin: defaults.includes(id) };
}

type StringOverlay = {
  extra: string[];
  disabled: string[];
  reenabled: string[];
  removed: string[];
  penalties: Record<string, number>;
};

function parseStringOverlay(
  raw: unknown,
  extraKey: string,
  disabledKey: string,
  reenabledKey: string,
  removedKey: string,
  normalizeFn: (raw: unknown) => string
): StringOverlay {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    extra: uniqStrings((Array.isArray(src[extraKey]) ? src[extraKey] : []).map(normalizeFn).filter(Boolean)),
    disabled: uniqStrings((Array.isArray(src[disabledKey]) ? src[disabledKey] : []).map(normalizeFn).filter(Boolean)),
    reenabled: uniqStrings((Array.isArray(src[reenabledKey]) ? src[reenabledKey] : []).map(normalizeFn).filter(Boolean)),
    removed: uniqStrings((Array.isArray(src[removedKey]) ? src[removedKey] : []).map(normalizeFn).filter(Boolean)),
    penalties: parsePenaltyMap(src['penalties'] || src['queryPenalties']),
  };
}

export function emptyEventQueryOverlay(): EventQueryOverlay {
  return {
    extraQueries: [],
    disabledQueries: [],
    reenabledQueries: [],
    removedQueries: [],
    extraSeeds: [],
    disabledSeeds: [],
    reenabledSeeds: [],
    removedSeeds: [],
    extraBlockDomains: [],
    disabledBlockDomains: [],
    reenabledBlockDomains: [],
    removedBlockDomains: [],
    queryPenalties: {},
  };
}

export function parseEventQueryOverlay(raw: unknown): EventQueryOverlay {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const queries = parseStringOverlay(src, 'extraQueries', 'disabledQueries', 'reenabledQueries', 'removedQueries', normalizeEventQuery);
  const seeds = parseStringOverlay(src, 'extraSeeds', 'disabledSeeds', 'reenabledSeeds', 'removedSeeds', asSeedQueryId);
  const blocks = parseStringOverlay(src, 'extraBlockDomains', 'disabledBlockDomains', 'reenabledBlockDomains', 'removedBlockDomains', normalizeBlockDomain);
  return {
    extraQueries: queries.extra,
    disabledQueries: queries.disabled,
    reenabledQueries: queries.reenabled,
    removedQueries: queries.removed,
    extraSeeds: seeds.extra,
    disabledSeeds: seeds.disabled,
    reenabledSeeds: seeds.reenabled,
    removedSeeds: seeds.removed,
    extraBlockDomains: blocks.extra,
    disabledBlockDomains: blocks.disabled,
    reenabledBlockDomains: blocks.reenabled,
    removedBlockDomains: blocks.removed,
    queryPenalties: { ...queries.penalties, ...parsePenaltyMap(src['queryPenalties']) },
  };
}

export function overlayFromCityDiscovery(discovery: unknown, cityDoc?: unknown): EventQueryOverlay {
  const d = discovery && typeof discovery === 'object' ? (discovery as Record<string, unknown>) : {};
  const city = cityDoc && typeof cityDoc === 'object' ? (cityDoc as Record<string, unknown>) : {};
  const queries = parseEventQueryOverlay(d['eventQueryConfig']);
  const seeds = parseEventQueryOverlay(d['eventSeedConfig']);
  const blocks = parseEventQueryOverlay(d['eventBlockConfig']);
  return {
    extraQueries: queries.extraQueries,
    disabledQueries: queries.disabledQueries,
    reenabledQueries: queries.reenabledQueries,
    removedQueries: queries.removedQueries,
    extraSeeds: seeds.extraSeeds,
    disabledSeeds: seeds.disabledSeeds,
    reenabledSeeds: seeds.reenabledSeeds,
    removedSeeds: seeds.removedSeeds,
    extraBlockDomains: uniqStrings([
      ...blocks.extraBlockDomains,
      ...queries.extraBlockDomains,
      ...(Array.isArray(d['eventBlockDomains']) ? d['eventBlockDomains'] : []),
      ...(Array.isArray(city['eventBlockDomains']) ? city['eventBlockDomains'] : []),
    ].map(normalizeBlockDomain).filter(Boolean)),
    disabledBlockDomains: blocks.disabledBlockDomains,
    reenabledBlockDomains: blocks.reenabledBlockDomains,
    removedBlockDomains: blocks.removedBlockDomains,
    queryPenalties: {
      ...queries.queryPenalties,
      ...seeds.queryPenalties,
      ...parsePenaltyMap(d['eventQueryPenalties']),
    },
  };
}

function resolveStringList(
  defaults: string[],
  globalPart: StringOverlay,
  cityPart: StringOverlay,
  legacy: string[]
): { enabled: EventQueryItem[]; catalog: EventQueryItem[]; disabledIds: string[]; penalties: Record<string, number> } {
  const hasConfig =
    cityPart.extra.length ||
    cityPart.disabled.length ||
    cityPart.reenabled.length ||
    cityPart.removed.length ||
    globalPart.extra.length ||
    globalPart.disabled.length ||
    globalPart.removed.length;
  const base = !hasConfig && legacy.length ? legacy : defaults;
  const disabled = new Set(globalPart.disabled);
  for (const id of cityPart.reenabled) disabled.delete(id);
  for (const id of cityPart.disabled) disabled.add(id);
  const removed = new Set(globalPart.removed);
  for (const id of cityPart.removed) removed.add(id);
  const byId = new Map<string, EventQueryItem>();
  for (const item of base) byId.set(item, catalogItem(item, defaults));
  for (const item of globalPart.extra.concat(cityPart.extra)) byId.set(item, catalogItem(item, defaults));
  const catalog = [...byId.values()].filter((c) => !removed.has(c.id));
  return {
    enabled: catalog.filter((c) => !disabled.has(c.id)),
    catalog,
    disabledIds: [...disabled],
    penalties: { ...globalPart.penalties, ...cityPart.penalties },
  };
}

export type EventDiscoveryPlan = {
  queries: ReturnType<typeof resolveStringList>;
  seeds: ReturnType<typeof resolveStringList>;
  blocks: ReturnType<typeof resolveStringList>;
  extraBlockDomains: string[];
  penalties: Record<string, number>;
  extraKeywords: string[];
};

export function resolveEventDiscoveryPlan(
  cityId: string,
  globalOverlay: EventQueryOverlay,
  cityOverlay: EventQueryOverlay,
  cityDoc?: unknown
): EventDiscoveryPlan {
  const doc = cityDoc && typeof cityDoc === 'object' ? (cityDoc as Record<string, unknown>) : {};
  const discovery = doc['discovery'] && typeof doc['discovery'] === 'object'
    ? (doc['discovery'] as Record<string, unknown>)
    : {};
  const queryDefaults = DEFAULT_EVENT_SEARCH_QUERIES[cityId] || [
    `repair cafe ${cityId}`,
    `second hand market ${cityId}`,
    `circular economy event ${cityId}`,
  ];
  const seedDefaults = (DEFAULT_EVENT_SEED_URLS[cityId] || []).map(asSeedQueryId).filter(Boolean);
  const legacyQueries = uniqStrings(
    (discovery['eventSearchQueries'] || doc['eventSearchQueries'] || []) as unknown[]
  ).map(normalizeEventQuery).filter(Boolean);
  const legacySeeds = uniqStrings(
    (discovery['eventSeedUrls'] || doc['eventSeedUrls'] || []) as unknown[]
  ).map(asSeedQueryId).filter(Boolean);
  const queries = resolveStringList(
    queryDefaults,
    {
      extra: globalOverlay.extraQueries,
      disabled: globalOverlay.disabledQueries,
      reenabled: globalOverlay.reenabledQueries,
      removed: globalOverlay.removedQueries,
      penalties: globalOverlay.queryPenalties,
    },
    {
      extra: cityOverlay.extraQueries,
      disabled: cityOverlay.disabledQueries,
      reenabled: cityOverlay.reenabledQueries,
      removed: cityOverlay.removedQueries,
      penalties: cityOverlay.queryPenalties,
    },
    legacyQueries
  );
  const seeds = resolveStringList(
    seedDefaults,
    {
      extra: globalOverlay.extraSeeds,
      disabled: globalOverlay.disabledSeeds,
      reenabled: globalOverlay.reenabledSeeds,
      removed: globalOverlay.removedSeeds,
      penalties: globalOverlay.queryPenalties,
    },
    {
      extra: cityOverlay.extraSeeds,
      disabled: cityOverlay.disabledSeeds,
      reenabled: cityOverlay.reenabledSeeds,
      removed: cityOverlay.removedSeeds,
      penalties: cityOverlay.queryPenalties,
    },
    legacySeeds
  );
  const blockDefaults = DEFAULT_EVENT_BLOCK_DOMAINS.slice();
  const blocks = resolveStringList(
    blockDefaults,
    {
      extra: globalOverlay.extraBlockDomains,
      disabled: globalOverlay.disabledBlockDomains,
      reenabled: globalOverlay.reenabledBlockDomains,
      removed: globalOverlay.removedBlockDomains,
      penalties: {},
    },
    {
      extra: cityOverlay.extraBlockDomains,
      disabled: cityOverlay.disabledBlockDomains,
      reenabled: cityOverlay.reenabledBlockDomains,
      removed: cityOverlay.removedBlockDomains,
      penalties: {},
    },
    []
  );
  return {
    queries,
    seeds,
    blocks,
    extraBlockDomains: uniqStrings([...globalOverlay.extraBlockDomains, ...cityOverlay.extraBlockDomains]),
    penalties: { ...queries.penalties, ...seeds.penalties },
    extraKeywords: uniqStrings((discovery['eventKeywords'] || doc['eventKeywords'] || []) as unknown[]),
  };
}

export function eventQueriesFromRow(row: unknown): string[] {
  const doc = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const candidate = doc['candidate'] && typeof doc['candidate'] === 'object'
    ? (doc['candidate'] as Record<string, unknown>)
    : {};
  const stored = uniqStrings([
    ...(Array.isArray(doc['eventQueries']) ? doc['eventQueries'] : []),
    ...(Array.isArray(candidate['eventQueries']) ? candidate['eventQueries'] : []),
  ]);
  if (stored.length) return stored;
  const evidence = Array.isArray(doc['evidence']) ? doc['evidence'] : [];
  const snippet = String((evidence[0] && typeof evidence[0] === 'object'
    ? (evidence[0] as Record<string, unknown>)['snippet']
    : '') || '');
  const viaQuery = snippet.match(/query=([^;]+)/i);
  if (viaQuery) return uniqStrings([viaQuery[1]]);
  return [];
}

export function parseEventQueryStats(raw: unknown): EventQueryStat[] {
  if (!Array.isArray(raw)) return [];
  const out: EventQueryStat[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r['id'] || r['key'] || '').replace(/^eventq:/, '').trim();
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

export function parseEventQuerySuggestions(raw: unknown): { period: string; remove: EventQuerySuggestion[]; add: EventQuerySuggestion[] } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mapRow = (row: unknown, action: EventQuerySuggestion['action']): EventQuerySuggestion | null => {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const id = String(r['id'] || '').trim();
    if (!id) return null;
    return {
      id,
      support: Number(r['support'] || 0) || 0,
      approvalRate: Number.isFinite(Number(r['approvalRate'])) ? Number(r['approvalRate']) : undefined,
      action,
    };
  };
  return {
    period: String(src['period'] || '').trim(),
    remove: (Array.isArray(src['remove']) ? src['remove'] : [])
      .map((row) => mapRow(row, 'disable'))
      .filter((row): row is EventQuerySuggestion => !!row),
    add: (Array.isArray(src['add']) ? src['add'] : [])
      .map((row) => mapRow(row, 'add'))
      .filter((row): row is EventQuerySuggestion => !!row),
  };
}

export function queueEventTitle(row: unknown): string {
  const doc = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const candidate = doc['candidate'] && typeof doc['candidate'] === 'object'
    ? (doc['candidate'] as Record<string, unknown>)
    : {};
  return String(candidate['title'] || doc['id'] || '(missing title)').trim() || '(missing title)';
}

export type LastEventRun = {
  at: string;
  status: string;
  fetchedCount: number;
  queuedCount: number;
  skippedNotCircular: number;
  skippedPast: number;
  skippedApproved: number;
  skippedWrongCity: number;
  skippedBlockedDomain: number;
  skippedMemoryHard: number;
  skippedMemorySoft: number;
  queryYield: Record<string, ClauseYield>;
  errorSummary: string;
};

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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
    skippedWrongCity: num(r['skippedWrongCity']),
    skippedBlockedDomain: num(r['skippedBlockedDomain']),
    skippedMemoryHard: num(r['skippedMemoryHard']),
    skippedMemorySoft: num(r['skippedMemorySoft']),
    queryYield: parseClauseYield(r['queryYield']),
    errorSummary: String(r['errorSummary'] || '').trim(),
  };
}

/** @deprecated Use resolveEventDiscoveryPlan. Kept for any leftover callers. */
export type EventDiscoveryView = {
  queries: string[];
  queriesFromCity: boolean;
  seeds: string[];
  seedsFromCity: boolean;
  extraBlock: string[];
  extraKeywords: string[];
};

export function resolveEventDiscovery(cityId: string, city: unknown): EventDiscoveryView {
  const plan = resolveEventDiscoveryPlan(cityId, emptyEventQueryOverlay(), overlayFromCityDiscovery(
    city && typeof city === 'object' ? (city as Record<string, unknown>)['discovery'] : {},
    city
  ), city);
  return {
    queries: plan.queries.enabled.map((c) => c.id),
    queriesFromCity: plan.queries.enabled.some((c) => !c.builtin) || plan.queries.disabledIds.length > 0,
    seeds: plan.seeds.enabled.map((c) => c.label),
    seedsFromCity: plan.seeds.enabled.some((c) => !c.builtin) || plan.seeds.disabledIds.length > 0,
    extraBlock: plan.extraBlockDomains,
    extraKeywords: plan.extraKeywords,
  };
}
