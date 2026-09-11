'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CITY_QUERIES,
  asSeedId,
  eventQueriesFromRow,
  parseEventRunSummary,
  queryPenaltyFor,
  resolveEventDiscoveryPlan,
  seedId,
} = require('./event-discovery-queries');

test('stockholm defaults still include the current search strings', () => {
  const q = DEFAULT_CITY_QUERIES.stockholm;
  assert.ok(q.includes('repair cafe Stockholm'));
  assert.ok(q.includes('loppis Stockholm evenemang'));
});

test('city overlay can disable, add, and re-enable global disables', () => {
  const plan = resolveEventDiscoveryPlan(
    'stockholm',
    {
      extraQueries: ['bytfest Stockholm'],
      disabledQueries: ['fixit clinic Stockholm'],
      extraSeeds: ['https://example.com/loppis'],
    },
    {
      discovery: {
        eventQueryConfig: {
          extraQueries: ['klädbytardag Stockholm'],
          reenabledQueries: ['fixit clinic Stockholm'],
          disabledQueries: ['circular economy event Stockholm'],
        },
        eventSeedConfig: {
          extraSeeds: ['https://example.org/events'],
          disabledSeeds: ['https://loppiskartan.se/loppiskalender'],
        },
      },
    }
  );
  const queryIds = plan.queries.enabled.map((c) => c.id);
  const seedIds = plan.seeds.enabled.map((c) => c.id);
  assert.ok(queryIds.includes('bytfest Stockholm'));
  assert.ok(queryIds.includes('klädbytardag Stockholm'));
  assert.ok(queryIds.includes('fixit clinic Stockholm'));
  assert.ok(!queryIds.includes('circular economy event Stockholm'));
  assert.ok(seedIds.includes(seedId('https://example.com/loppis')));
  assert.ok(seedIds.includes(seedId('https://example.org/events')));
  assert.ok(!seedIds.includes(asSeedId('https://loppiskartan.se/loppiskalender')));
});

test('city overlay can disable a builtin blocked host and add extras', () => {
  const plan = resolveEventDiscoveryPlan(
    'stockholm',
    {},
    {
      discovery: {
        eventBlockConfig: {
          extraBlockDomains: ['noise.example'],
          disabledBlockDomains: ['facebook.com'],
        },
      },
    }
  );
  const enabled = plan.blocks.enabled.map((c) => c.id);
  assert.ok(enabled.includes('noise.example'));
  assert.ok(!enabled.includes('facebook.com'));
  assert.ok(enabled.includes('meetup.com'));
  assert.ok(plan.blocks.catalog.some((c) => c.id === 'facebook.com' && c.builtin));
});

test('city overlay can remove a builtin search query from the catalog', () => {
  const plan = resolveEventDiscoveryPlan(
    'stockholm',
    {},
    {
      discovery: {
        eventQueryConfig: {
          removedQueries: ['circular economy event Stockholm'],
        },
      },
    }
  );
  const catalogIds = plan.queries.catalog.map((c) => c.id);
  assert.ok(!catalogIds.includes('circular economy event Stockholm'));
  assert.ok(!plan.queries.enabled.map((c) => c.id).includes('circular economy event Stockholm'));
});

test('legacy eventSearchQueries still replace defaults when no overlay is set', () => {
  const plan = resolveEventDiscoveryPlan('milan', {}, {
    discovery: { eventSearchQueries: ['swap party Milano'] },
  });
  assert.deepEqual(plan.queries.enabled.map((c) => c.id), ['swap party Milano']);
});

test('queue rows fall back to evidence snippets when eventQueries are missing', () => {
  assert.deepEqual(
    eventQueriesFromRow({ eventQueries: ['repair cafe Stockholm'] }),
    ['repair cafe Stockholm']
  );
  assert.deepEqual(
    eventQueriesFromRow({ evidence: [{ snippet: 'search snippet; query=loppis Stockholm evenemang; url=https://x' }] }),
    ['loppis Stockholm evenemang']
  );
});

test('noisy queries get a confidence penalty', () => {
  assert.equal(queryPenaltyFor(['repair cafe Stockholm'], { 'repair cafe Stockholm': 0.1 }), 0.1);
  assert.equal(queryPenaltyFor(['other'], { 'repair cafe Stockholm': 0.1 }), 0);
});

test('parses the event run-summary log line', () => {
  const parsed = parseEventRunSummary(
    'noise\n[discover-events-agent] run-summary {"fetchedCount":10,"queryYield":{"repair cafe Stockholm":{"fetched":8,"queued":1}}}\n'
  );
  assert.equal(parsed.fetchedCount, 10);
  assert.equal(parsed.queryYield['repair cafe Stockholm'].queued, 1);
});
