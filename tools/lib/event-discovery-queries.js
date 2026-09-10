'use strict';

/**
 * Event search queries, seed URLs, and city/global overlays.
 * Keep DEFAULT_CITY_QUERIES / DEFAULT_CITY_SEED_URLS in sync with
 * frontend/src/app/data/event-discovery-defaults.ts
 */

const QUERY_PENALTY_CAP = 0.14;
const MAX_QUERY_LEN = 80;
const MAX_SEED_LEN = 240;
const MAX_QUERIES_HARD_CAP = 24;

const DEFAULT_CITY_QUERIES = {
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

const DEFAULT_CITY_SEED_URLS = {
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

function uniqStrings(values) {
  const out = [];
  for (const v of values || []) {
    const s = String(v || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function normalizeQuery(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > MAX_QUERY_LEN) return '';
  return s;
}

function normalizeSeed(raw) {
  const s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s) || s.length > MAX_SEED_LEN) return '';
  return s;
}

function parsePenaltyMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const n = Number(value);
    if (!id || !Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(QUERY_PENALTY_CAP, n);
  }
  return out;
}

function parseStringOverlay(raw, extraKey, disabledKey, reenabledKey, normalizeFn) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const asList = (value) => (Array.isArray(value) ? value : []);
  return {
    extra: uniqStrings(asList(src[extraKey]).map(normalizeFn).filter(Boolean)),
    disabled: uniqStrings(asList(src[disabledKey]).map(normalizeFn).filter(Boolean)),
    reenabled: uniqStrings(asList(src[reenabledKey]).map(normalizeFn).filter(Boolean)),
    penalties: parsePenaltyMap(src.penalties || src.queryPenalties),
  };
}

function queryPenaltyFor(eventQueries, penalties) {
  let max = 0;
  for (const id of eventQueries || []) {
    const n = Number((penalties && penalties[id]) || 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Math.min(QUERY_PENALTY_CAP, Math.max(0, max));
}

function eventQueriesFromRow(row) {
  const doc = row && typeof row === 'object' ? row : {};
  const candidate = doc.candidate && typeof doc.candidate === 'object' ? doc.candidate : {};
  const stored = uniqStrings([].concat(doc.eventQueries || []).concat(candidate.eventQueries || []));
  if (stored.length) return stored;
  const snippet = String(doc.evidence?.[0]?.snippet || '');
  const viaQuery = snippet.match(/query=([^;]+)/i);
  if (viaQuery) return uniqStrings([viaQuery[1]]);
  return [];
}

function parseEventRunSummary(outputText) {
  const lines = String(outputText || '').split('\n');
  const marker = '[discover-events-agent] run-summary ';
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].indexOf(marker);
    if (at < 0) continue;
    try {
      const parsed = JSON.parse(lines[i].slice(at + marker.length).trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function seedId(url) {
  const normalized = normalizeSeed(url) || String(url || '').trim();
  return normalized ? `seed:${normalized}` : '';
}

function asSeedId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.toLowerCase().startsWith('seed:')) return seedId(s.slice(5));
  return seedId(s);
}

function queryLabel(id) {
  const s = String(id || '').trim();
  if (s.toLowerCase().startsWith('seed:')) return s.slice(5);
  return s;
}

const DEFAULT_BLOCK_DOMAINS = [
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
];

function normalizeBlockDomain(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^www\./, '');
}

function extraBlockDomainsFrom(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return uniqStrings([].concat(src.extraBlockDomains || []).map(normalizeBlockDomain).filter(Boolean));
}

function overlayFromCityDoc(cityDoc) {
  const d = cityDoc && typeof cityDoc === 'object' ? cityDoc.discovery || {} : {};
  const queries = d.eventQueryConfig || {};
  const seeds = d.eventSeedConfig || {};
  const blocks = d.eventBlockConfig || {};
  const queryOverlay = parseStringOverlay(queries, 'extraQueries', 'disabledQueries', 'reenabledQueries', normalizeQuery);
  queryOverlay.penalties = {
    ...queryOverlay.penalties,
    ...parsePenaltyMap(d.eventQueryPenalties),
  };
  const seedOverlay = parseStringOverlay(seeds, 'extraSeeds', 'disabledSeeds', 'reenabledSeeds', asSeedId);
  seedOverlay.penalties = {
    ...seedOverlay.penalties,
    ...parsePenaltyMap(d.eventQueryPenalties),
  };
  const blockOverlay = parseStringOverlay(blocks, 'extraBlockDomains', 'disabledBlockDomains', 'reenabledBlockDomains', normalizeBlockDomain);
  blockOverlay.extra = uniqStrings(
    blockOverlay.extra.concat(
      extraBlockDomainsFrom({
        extraBlockDomains: [].concat(d.eventBlockDomains || cityDoc?.eventBlockDomains || []).concat(queries.extraBlockDomains || []),
      })
    )
  );
  return {
    queries: queryOverlay,
    seeds: seedOverlay,
    blocks: blockOverlay,
    extraBlockDomains: blockOverlay.extra,
    legacyQueries: uniqStrings([].concat(d.eventSearchQueries || cityDoc?.eventSearchQueries || []).map(normalizeQuery).filter(Boolean)),
    legacySeeds: uniqStrings([].concat(d.eventSeedUrls || cityDoc?.eventSeedUrls || []).map(asSeedId).filter(Boolean)),
  };
}

function parseGlobalOverlay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const blocks = parseStringOverlay(src, 'extraBlockDomains', 'disabledBlockDomains', 'reenabledBlockDomains', normalizeBlockDomain);
  return {
    queries: parseStringOverlay(src, 'extraQueries', 'disabledQueries', 'reenabledQueries', normalizeQuery),
    seeds: parseStringOverlay(src, 'extraSeeds', 'disabledSeeds', 'reenabledSeeds', asSeedId),
    blocks,
    extraBlockDomains: blocks.extra,
  };
}

function catalogItem(id, defaults) {
  return { id, label: queryLabel(id), builtin: defaults.includes(id) };
}

function resolveStringList(defaults, globalPart, cityPart, legacy) {
  const hasConfig =
    cityPart.extra.length ||
    cityPart.disabled.length ||
    cityPart.reenabled.length ||
    globalPart.extra.length ||
    globalPart.disabled.length;
  const base = !hasConfig && legacy.length ? legacy : defaults;
  const disabled = new Set(globalPart.disabled);
  for (const id of cityPart.reenabled) disabled.delete(id);
  for (const id of cityPart.disabled) disabled.add(id);
  const byId = new Map();
  for (const item of base) byId.set(item, catalogItem(item, defaults));
  for (const item of globalPart.extra.concat(cityPart.extra)) {
    byId.set(item, catalogItem(item, defaults));
  }
  const catalog = [...byId.values()];
  return {
    enabled: catalog.filter((c) => !disabled.has(c.id)),
    catalog,
    disabledIds: [...disabled],
    penalties: { ...globalPart.penalties, ...cityPart.penalties },
  };
}

function resolveEventDiscoveryPlan(cityId, globalDoc, cityDoc) {
  const global = parseGlobalOverlay(globalDoc);
  const city = overlayFromCityDoc(cityDoc);
  const queryDefaults = DEFAULT_CITY_QUERIES[cityId] || [
    `repair cafe ${cityId}`,
    `second hand market ${cityId}`,
    `circular economy event ${cityId}`,
  ];
  const seedDefaults = (DEFAULT_CITY_SEED_URLS[cityId] || []).map(asSeedId).filter(Boolean);
  const queries = resolveStringList(queryDefaults, global.queries, city.queries, city.legacyQueries);
  const seeds = resolveStringList(seedDefaults, global.seeds, city.seeds, city.legacySeeds);
  const blocks = resolveStringList(DEFAULT_BLOCK_DOMAINS.slice(), global.blocks, city.blocks, []);
  return {
    queries,
    seeds,
    blocks,
    extraBlockDomains: uniqStrings(global.extraBlockDomains.concat(city.extraBlockDomains)),
    penalties: { ...queries.penalties, ...seeds.penalties },
  };
}

function queryYieldToObject(map) {
  const out = {};
  for (const [id, row] of map instanceof Map ? map.entries() : Object.entries(map || {})) {
    if (!id) continue;
    out[id] = {
      fetched: Number(row && row.fetched) || 0,
      queued: Number(row && row.queued) || 0,
    };
  }
  return out;
}

module.exports = {
  DEFAULT_BLOCK_DOMAINS,
  DEFAULT_CITY_QUERIES,
  DEFAULT_CITY_SEED_URLS,
  MAX_QUERIES_HARD_CAP,
  QUERY_PENALTY_CAP,
  asSeedId,
  eventQueriesFromRow,
  extraBlockDomainsFrom,
  normalizeBlockDomain,
  normalizeQuery,
  normalizeSeed,
  overlayFromCityDoc,
  parseEventRunSummary,
  parseGlobalOverlay,
  queryLabel,
  queryPenaltyFor,
  queryYieldToObject,
  resolveEventDiscoveryPlan,
  seedId,
};
