'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_OSM_CLAUSES,
  buildOverpassQuery,
  clausePenaltyFor,
  clausesFromQueueRow,
  computeClausePenalties,
  matchingClauseIds,
  normalizeClause,
  recommendClauseAdditions,
  recommendClauseRemovals,
  resolveOsmClauses,
  splitClausesByGroup,
  tagsToClauseIds,
  parseOsmRunSummary,
  clauseYieldToObject,
} = require('./osm-discovery-queries');

test('default catalog still includes the current Overpass tags', () => {
  const ids = DEFAULT_OSM_CLAUSES.map((c) => c.id);
  for (const id of [
    'shop:second_hand',
    'shop:charity',
    'shop:rental',
    'shop:vintage',
    'shop:antiques',
    'name:vintage',
    'name:humana',
    'name:libraccio',
    'shop:books+second_hand',
    'shop:clothes+second_hand',
    'shop:clothes+vintage',
    'shop:bicycle+rental',
    'shop:bicycle+repair',
    'shop:variety_store+second_hand',
    'amenity:recycling',
    'amenity:recycling_centre',
  ]) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes('shop:books'));
  assert.ok(!ids.includes('shop:variety_store'));
});

test('rejects unsafe extra clauses', () => {
  assert.equal(normalizeClause({ kind: 'tag', key: 'shop', value: 'second_hand"];out;' }), null);
  assert.equal(normalizeClause({ kind: 'name_regex', key: 'shop', pattern: '.*' }), null);
  assert.equal(normalizeClause({ kind: 'tag', key: 'highway', value: 'bus_stop' }), null);
  assert.equal(normalizeClause({ kind: 'and_tag', key: 'shop', value: 'clothes', andKey: 'organic', andValue: 'yes' }), null);
  assert.ok(normalizeClause({ kind: 'and_tag', key: 'shop', value: 'clothes', andKey: 'vintage', andValue: 'yes' }));
});

test('city overlay can disable, add, and re-enable global disables', () => {
  const resolved = resolveOsmClauses(
    { disabledClauseIds: ['shop:charity'], extraClauses: [{ kind: 'tag', key: 'shop', value: 'antiques' }] },
    { reenabledClauseIds: ['shop:charity'], extraClauses: [{ kind: 'name_regex', key: 'shop', pattern: 'loppis' }] }
  );
  const ids = resolved.enabled.map((c) => c.id);
  assert.ok(ids.includes('shop:charity'));
  assert.ok(ids.includes('shop:antiques'));
  assert.ok(ids.includes('name:loppis'));
  assert.ok(!ids.includes('highway:bus_stop'));
});

test('city disable removes a builtin from Overpass', () => {
  const resolved = resolveOsmClauses({}, { disabledClauseIds: ['shop:variety_store+second_hand'] });
  assert.ok(!resolved.enabled.some((c) => c.id === 'shop:variety_store+second_hand'));
  const { shops } = splitClausesByGroup(resolved.enabled);
  const q = buildOverpassQuery(shops, 59.3, 18.0, 6000);
  assert.ok(!q.includes('variety_store'));
  assert.ok(q.includes('second_hand'));
});

test('city overlay can remove a builtin from the catalog', () => {
  const resolved = resolveOsmClauses({}, { removedClauseIds: ['shop:charity'] });
  assert.ok(!resolved.catalog.some((c) => c.id === 'shop:charity'));
  assert.ok(!resolved.enabled.some((c) => c.id === 'shop:charity'));
  assert.ok(resolved.catalog.some((c) => c.id === 'shop:second_hand'));
});

test('book and variety queries require second_hand on Overpass, not a post-filter', () => {
  const { shops } = splitClausesByGroup(resolveOsmClauses({}, {}).enabled);
  const q = buildOverpassQuery(shops, 45.46, 9.19, 9000);
  assert.ok(q.includes('["shop"="books"]["second_hand"~"^(yes|only)$"]'));
  assert.ok(q.includes('["shop"="variety_store"]["second_hand"~"^(yes|only)$"]'));
  assert.ok(q.includes('["shop"="clothes"]["vintage"~"^(yes|only)$"]'));
  assert.ok(q.includes('["shop"="antiques"]'));
  assert.ok(q.includes('libraccio'));
  assert.equal((q.match(/\["shop"="books"\]\["second_hand"/g) || []).length, 2);
  assert.ok(!/\["shop"="books"\]\(around/.test(q));
  const enabled = resolveOsmClauses({}, {}).enabled;
  assert.deepEqual(
    matchingClauseIds({ shop: 'books', second_hand: 'yes' }, 'Mondadori', enabled).filter((id) => id.includes('books')),
    ['shop:books+second_hand']
  );
  assert.deepEqual(
    matchingClauseIds({ shop: 'books' }, 'Mondadori', enabled).filter((id) => id.includes('books')),
    []
  );
});

test('attribution matches tags and name regex independently', () => {
  const enabled = resolveOsmClauses({}, {}).enabled;
  const vintageShop = matchingClauseIds(
    { shop: 'vintage' },
    'Vintage Store',
    enabled
  );
  assert.ok(vintageShop.includes('shop:vintage'));
  assert.ok(vintageShop.includes('name:vintage'));
  const humana = matchingClauseIds({ shop: 'clothes' }, 'Humana Second Hand', enabled);
  assert.deepEqual(humana, ['name:humana']);
});

test('learning down-ranks noisy clauses and proposes add/remove', () => {
  const stats = [
    { key: 'shop:books', reviewed: 20, approvalRate: 0.1 },
    { key: 'shop:second_hand', reviewed: 20, approvalRate: 0.9 },
  ];
  const penalties = computeClausePenalties(stats);
  assert.ok(penalties['shop:books'] > 0);
  assert.equal(penalties['shop:second_hand'], undefined);
  assert.equal(clausePenaltyFor(['shop:books'], penalties), penalties['shop:books']);
  const removals = recommendClauseRemovals(stats);
  assert.equal(removals[0].id, 'shop:books');
  const adds = recommendClauseAdditions({ 'shop:antiques': 8, 'shop:second_hand': 8 }, ['shop:second_hand']);
  assert.equal(adds[0].id, 'shop:antiques');
});

test('queue rows fall back to evidence snippets when osmClauses are missing', () => {
  assert.deepEqual(
    clausesFromQueueRow({ evidence: [{ snippet: 'shop=books · amenity=recycling' }] }),
    ['shop:books', 'amenity:recycling']
  );
  assert.deepEqual(tagsToClauseIds({ shop: 'antiques', amenity: '' }), ['shop:antiques']);
});

test('parses the OSM run-summary log line', () => {
  const summary = parseOsmRunSummary(
    'noise\n[discover-osm] run-summary {"fetchedCount":10,"clauseYield":{"shop:books":{"fetched":8,"queued":1}}}\n'
  );
  assert.equal(summary.fetchedCount, 10);
  assert.equal(summary.clauseYield['shop:books'].queued, 1);
  assert.deepEqual(clauseYieldToObject(new Map([['shop:books', { fetched: 8, queued: 1 }]])), {
    'shop:books': { fetched: 8, queued: 1 },
  });
});
