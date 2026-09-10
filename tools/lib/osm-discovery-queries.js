'use strict';

/**
 * OSM place-discovery clauses: defaults, city/global overlays, Overpass builders,
 * and post-fetch attribution. Keep DEFAULT_OSM_CLAUSES in sync with
 * frontend/src/app/data/osm-discovery-queries.ts
 */

const ALLOWED_KEYS = ['shop', 'amenity', 'craft'];
const TAG_VALUE_RE = /^[a-z0-9_]{1,40}$/;
const NAME_PATTERN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CLAUSE_PENALTY_CAP = 0.14;
const GLOBAL_SCOPE = '__global__';

const OSM_AND_KEYS = ['second_hand', 'vintage', 'rental', 'repair'];
const AND_KEYS = OSM_AND_KEYS;
const OSM_AND_SHOP_VALUES = [
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
];

function andClauseId(key, value, andKey, andValue) {
  return andValue === 'yes' ? `${key}:${value}+${andKey}` : `${key}:${value}+${andKey}:${andValue}`;
}

function andClause(value, andKey, andValue = 'yes') {
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
const DEFAULT_OSM_CLAUSES = [
  { id: 'shop:second_hand', group: 'shops', kind: 'tag', key: 'shop', value: 'second_hand', label: 'shop=second_hand', builtin: true },
  { id: 'shop:charity', group: 'shops', kind: 'tag', key: 'shop', value: 'charity', label: 'shop=charity', builtin: true },
  { id: 'shop:rental', group: 'shops', kind: 'tag', key: 'shop', value: 'rental', label: 'shop=rental', builtin: true },
  { id: 'shop:vintage', group: 'shops', kind: 'tag', key: 'shop', value: 'vintage', label: 'shop=vintage', builtin: true },
  { id: 'shop:antiques', group: 'shops', kind: 'tag', key: 'shop', value: 'antiques', label: 'shop=antiques', builtin: true },
  { id: 'name:vintage', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'vintage', label: 'shop name contains “vintage”', builtin: true },
  { id: 'name:humana', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'humana', label: 'shop name contains “humana”', builtin: true },
  { id: 'name:libraccio', group: 'shops', kind: 'name_regex', key: 'shop', pattern: 'libraccio', label: 'shop name contains “libraccio”', builtin: true },
  ...SECOND_HAND_SHOPS.map((value) => andClause(value, 'second_hand')),
  ...['clothes', 'furniture', 'jewelry', 'music'].map((value) => andClause(value, 'vintage')),
  ...['bicycle', 'sports'].map((value) => andClause(value, 'rental')),
  ...['bicycle', 'computer', 'electronics'].map((value) => andClause(value, 'repair')),
  { id: 'amenity:recycling', group: 'amenities', kind: 'tag', key: 'amenity', value: 'recycling', label: 'amenity=recycling', builtin: true },
  { id: 'amenity:recycling_centre', group: 'amenities', kind: 'tag', key: 'amenity', value: 'recycling_centre', label: 'amenity=recycling_centre', builtin: true },
];

function clauseIdFor(kind, key, token) {
  const t = String(token || '').toLowerCase();
  if (kind === 'name_regex') return `name:${t}`;
  return `${key}:${t}`;
}

function clauseLabel(clause) {
  if (clause.kind === 'name_regex') return `${clause.key} name contains “${clause.pattern}”`;
  if (clause.kind === 'and_tag') return `${clause.key}=${clause.value} and ${clause.andKey}=${clause.andValue}`;
  return `${clause.key}=${clause.value}`;
}

function groupForKey(key) {
  return key === 'amenity' ? 'amenities' : 'shops';
}

function normalizeClause(raw, { builtin = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || 'tag').trim();
  const key = String(raw.key || '').trim().toLowerCase();
  if (!ALLOWED_KEYS.includes(key)) return null;
  if (kind === 'tag') {
    const value = String(raw.value || '').trim().toLowerCase();
    if (!TAG_VALUE_RE.test(value)) return null;
    const id = String(raw.id || clauseIdFor('tag', key, value)).trim() || clauseIdFor('tag', key, value);
    return {
      id,
      group: groupForKey(key),
      kind: 'tag',
      key,
      value,
      label: String(raw.label || clauseLabel({ kind: 'tag', key, value })),
      builtin: builtin === true,
    };
  }
  if (kind === 'name_regex') {
    const pattern = String(raw.pattern || raw.value || '').trim().toLowerCase();
    if (!NAME_PATTERN_RE.test(pattern)) return null;
    const id = String(raw.id || clauseIdFor('name_regex', key, pattern)).trim() || clauseIdFor('name_regex', key, pattern);
    return {
      id,
      group: groupForKey(key),
      kind: 'name_regex',
      key,
      pattern,
      label: String(raw.label || clauseLabel({ kind: 'name_regex', key, pattern })),
      builtin: builtin === true,
    };
  }
  if (kind === 'and_tag') {
    const value = String(raw.value || '').trim().toLowerCase();
    const andKey = String(raw.andKey || '').trim().toLowerCase();
    const andValue = String(raw.andValue || '').trim().toLowerCase();
    if (!TAG_VALUE_RE.test(value) || !AND_KEYS.includes(andKey) || !TAG_VALUE_RE.test(andValue)) return null;
    const id = String(raw.id || andClauseId(key, value, andKey, andValue)).trim()
      || andClauseId(key, value, andKey, andValue);
    return {
      id,
      group: groupForKey(key),
      kind: 'and_tag',
      key,
      value,
      andKey,
      andValue,
      label: String(raw.label || clauseLabel({ kind: 'and_tag', key, value, andKey, andValue })),
      builtin: builtin === true,
    };
  }
  return null;
}

function uniqStrings(values) {
  const out = [];
  for (const v of values || []) {
    const s = String(v || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function parsePenaltyMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const n = Number(value);
    if (!id || !Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(CLAUSE_PENALTY_CAP, n);
  }
  return out;
}

function parseOverlay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const extraClauses = [];
  for (const row of [].concat(src.extraClauses || [])) {
    const clause = normalizeClause(row, { builtin: false });
    if (clause) extraClauses.push(clause);
  }
  return {
    disabledClauseIds: uniqStrings(src.disabledClauseIds),
    reenabledClauseIds: uniqStrings(src.reenabledClauseIds),
    extraClauses,
    clausePenalties: parsePenaltyMap(src.clausePenalties),
  };
}

function overlayFromCityDoc(cityDoc) {
  const d = cityDoc && typeof cityDoc === 'object' ? cityDoc.discovery || {} : {};
  return parseOverlay({
    disabledClauseIds: d.osmQueries?.disabledClauseIds || d.osmDisabledClauseIds,
    reenabledClauseIds: d.osmQueries?.reenabledClauseIds || d.osmReenabledClauseIds,
    extraClauses: d.osmQueries?.extraClauses || d.osmExtraClauses,
    clausePenalties: d.osmClausePenalties || d.osmQueries?.clausePenalties,
  });
}

function resolveOsmClauses(globalOverlay, cityOverlay) {
  const global = parseOverlay(globalOverlay);
  const city = parseOverlay(cityOverlay);
  const disabled = new Set(global.disabledClauseIds);
  for (const id of city.reenabledClauseIds) disabled.delete(id);
  for (const id of city.disabledClauseIds) disabled.add(id);

  const byId = new Map();
  for (const c of DEFAULT_OSM_CLAUSES) byId.set(c.id, { ...c });
  for (const c of global.extraClauses) byId.set(c.id, { ...c, builtin: false });
  for (const c of city.extraClauses) byId.set(c.id, { ...c, builtin: false });

  const catalog = [...byId.values()];
  const enabled = catalog.filter((c) => !disabled.has(c.id));
  const penalties = { ...global.clausePenalties, ...city.clausePenalties };
  return {
    enabled,
    catalog,
    disabledIds: [...disabled],
    penalties,
    byId,
  };
}

function extraOverpassFilter(andKey, andValue) {
  if (andValue === 'yes' && AND_KEYS.includes(andKey)) return `["${andKey}"~"^(yes|only)$"]`;
  return `["${andKey}"="${andValue}"]`;
}

function overpassSelector(clause) {
  if (clause.kind === 'tag') return `["${clause.key}"="${clause.value}"]`;
  if (clause.kind === 'name_regex') return `["${clause.key}"]["name"~"${clause.pattern}",i]`;
  if (clause.kind === 'and_tag') {
    return `["${clause.key}"="${clause.value}"]${extraOverpassFilter(clause.andKey, clause.andValue)}`;
  }
  return '';
}

function buildOverpassQuery(clauses, lat, lng, radiusM) {
  const r = Math.max(1000, Math.trunc(Number(radiusM) || 9000));
  const q = Number(lat);
  const p = Number(lng);
  const lines = [];
  for (const clause of clauses || []) {
    const sel = overpassSelector(clause);
    if (!sel) continue;
    lines.push(`  node${sel}(around:${r},${q},${p});`);
    lines.push(`  way${sel}(around:${r},${q},${p});`);
  }
  if (!lines.length) return '';
  return `
[out:json][timeout:90];
(
${lines.join('\n')}
);
out center;
`.trimStart();
}

function splitClausesByGroup(clauses) {
  const shops = [];
  const amenities = [];
  for (const c of clauses || []) {
    if (c.group === 'amenities') amenities.push(c);
    else shops.push(c);
  }
  return { shops, amenities };
}

function tagHasValue(tags, key, value) {
  const raw = String((tags && tags[key]) || '').toLowerCase();
  if (!raw) return false;
  if (raw === value) return true;
  return raw.split(/[;,]/).map((s) => s.trim()).includes(value);
}

function tagIsYes(tags, key) {
  const raw = String((tags && tags[key]) || '').toLowerCase();
  return ['yes', 'only', 'true', '1'].includes(raw);
}

function matchClause(tags, name, clause) {
  if (!clause) return false;
  switch (clause.kind) {
    case 'tag':
      return tagHasValue(tags || {}, clause.key, clause.value);
    case 'name_regex': {
      if (!String((tags && tags[clause.key]) || '').trim()) return false;
      const n = String(name || '');
      try {
        return new RegExp(clause.pattern, 'i').test(n);
      } catch {
        return n.toLowerCase().includes(String(clause.pattern || '').toLowerCase());
      }
    }
    case 'and_tag': {
      if (!tagHasValue(tags || {}, clause.key, clause.value)) return false;
      if (clause.andValue === 'yes') return tagIsYes(tags, clause.andKey);
      return tagHasValue(tags || {}, clause.andKey, clause.andValue);
    }
    default:
      return false;
  }
}

function matchingClauses(tags, name, clauses) {
  return (clauses || []).filter((c) => matchClause(tags, name, c));
}

function matchingClauseIds(tags, name, clauses) {
  return matchingClauses(tags, name, clauses).map((c) => c.id);
}

function compactOsmTags(tags) {
  const out = {};
  for (const key of ALLOWED_KEYS) {
    const v = String((tags && tags[key]) || '').trim();
    if (v) out[key] = v;
  }
  return out;
}

function clausePenaltyFor(matchingIds, penalties) {
  let max = 0;
  for (const id of matchingIds || []) {
    const n = Number((penalties && penalties[id]) || 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Math.min(CLAUSE_PENALTY_CAP, Math.max(0, max));
}

function clausesFromQueueRow(row) {
  const candidate = row && row.candidate && typeof row.candidate === 'object' ? row.candidate : {};
  const stored = [].concat(row?.osmClauses || candidate.osmClauses || []);
  const fromStored = uniqStrings(stored);
  if (fromStored.length) return fromStored;
  const snippet = String(row?.evidence?.[0]?.snippet || '');
  const out = [];
  const shop = snippet.match(/shop=([a-z0-9_]+)/i);
  if (shop) out.push(`shop:${shop[1].toLowerCase()}`);
  const amenity = snippet.match(/amenity=([a-z0-9_]+)/i);
  if (amenity) out.push(`amenity:${amenity[1].toLowerCase()}`);
  const craft = snippet.match(/craft=([a-z0-9_]+)/i);
  if (craft) out.push(`craft:${craft[1].toLowerCase()}`);
  return uniqStrings(out);
}

function tagsToClauseIds(osmTags) {
  const tags = osmTags && typeof osmTags === 'object' ? osmTags : {};
  const out = [];
  for (const key of ALLOWED_KEYS) {
    const raw = String(tags[key] || '').toLowerCase();
    if (!raw) continue;
    for (const value of raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      if (TAG_VALUE_RE.test(value)) out.push(`${key}:${value}`);
    }
  }
  return uniqStrings(out);
}

function computeClausePenalties(clauseStats, { minSupport = 8 } = {}) {
  const penalties = {};
  for (const row of clauseStats || []) {
    const reviewed = Number(row.reviewed || row.support || 0);
    const approvalRate = Number(row.approvalRate || 0);
    const id = String(row.key || row.id || '');
    if (!id || reviewed < minSupport) continue;
    if (approvalRate > 0.35) continue;
    penalties[id] = Math.min(
      CLAUSE_PENALTY_CAP,
      Number((0.06 + (0.35 - approvalRate) * 0.25).toFixed(3))
    );
  }
  return penalties;
}

function recommendClauseRemovals(clauseStats, { minSupport = 12 } = {}) {
  const out = [];
  for (const row of clauseStats || []) {
    const reviewed = Number(row.reviewed || row.support || 0);
    const approvalRate = Number(row.approvalRate || 0);
    const id = String(row.key || row.id || '');
    if (!id || reviewed < minSupport || approvalRate > 0.25) continue;
    out.push({
      id,
      support: reviewed,
      approvalRate,
      action: 'disable',
    });
  }
  return out.sort((a, b) => a.approvalRate - b.approvalRate || b.support - a.support);
}

function recommendClauseAdditions(approvedTagCounts, enabledIds, { minSupport = 5 } = {}) {
  const enabled = new Set(enabledIds || []);
  const out = [];
  const entries = approvedTagCounts instanceof Map
    ? [...approvedTagCounts.entries()]
    : Object.entries(approvedTagCounts || {});
  for (const [id, count] of entries) {
    const n = Number(count || 0);
    if (!id || enabled.has(id) || n < minSupport) continue;
    const [key, value] = String(id).split(':');
    if (!ALLOWED_KEYS.includes(key) || !TAG_VALUE_RE.test(String(value || ''))) continue;
    out.push({
      id,
      support: n,
      kind: 'tag',
      key,
      value,
      action: 'add',
    });
  }
  return out.sort((a, b) => b.support - a.support || a.id.localeCompare(b.id));
}

function clauseYieldToObject(clauseYield) {
  const out = {};
  const entries = clauseYield instanceof Map ? clauseYield.entries() : Object.entries(clauseYield || {});
  for (const [id, row] of entries) {
    if (!id) continue;
    out[id] = {
      fetched: Number(row?.fetched || 0) || 0,
      queued: Number(row?.queued || 0) || 0,
    };
  }
  return out;
}

function parseOsmRunSummary(outputText) {
  const lines = String(outputText || '').split('\n');
  const marker = '[discover-osm] run-summary ';
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const at = line.indexOf(marker);
    if (at < 0) continue;
    const json = line.slice(at + marker.length).trim();
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = {
  ALLOWED_KEYS,
  CLAUSE_PENALTY_CAP,
  DEFAULT_OSM_CLAUSES,
  GLOBAL_SCOPE,
  OSM_AND_KEYS,
  OSM_AND_SHOP_VALUES,
  buildOverpassQuery,
  clausePenaltyFor,
  clauseYieldToObject,
  clausesFromQueueRow,
  compactOsmTags,
  computeClausePenalties,
  matchingClauseIds,
  matchingClauses,
  matchClause,
  normalizeClause,
  overlayFromCityDoc,
  parseOverlay,
  parseOsmRunSummary,
  recommendClauseAdditions,
  recommendClauseRemovals,
  resolveOsmClauses,
  splitClausesByGroup,
  tagsToClauseIds,
};
