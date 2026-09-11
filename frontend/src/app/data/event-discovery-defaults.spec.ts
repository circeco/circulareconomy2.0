import {
  asSeedQueryId,
  eventQueriesFromRow,
  overlayFromCityDiscovery,
  resolveEventDiscoveryPlan,
  emptyEventQueryOverlay,
} from './event-discovery-defaults';

describe('event-discovery-defaults', () => {
  it('lets a city disable a builtin search query and add extras', () => {
    const plan = resolveEventDiscoveryPlan(
      'stockholm',
      emptyEventQueryOverlay(),
      overlayFromCityDiscovery({
        eventQueryConfig: {
          extraQueries: ['klädbytardag Stockholm'],
          disabledQueries: ['circular economy event Stockholm'],
        },
        eventSeedConfig: {
          extraSeeds: ['https://example.org/events'],
        },
      })
    );
    const queryIds = plan.queries.enabled.map((c) => c.id);
    expect(queryIds).toContain('klädbytardag Stockholm');
    expect(queryIds).not.toContain('circular economy event Stockholm');
    expect(plan.seeds.enabled.map((c) => c.id)).toContain(asSeedQueryId('https://example.org/events'));
  });

  it('lets a city remove a builtin search query from the list', () => {
    const plan = resolveEventDiscoveryPlan(
      'stockholm',
      emptyEventQueryOverlay(),
      overlayFromCityDiscovery({
        eventQueryConfig: {
          removedQueries: ['circular economy event Stockholm'],
        },
      })
    );
    expect(plan.queries.catalog.map((c) => c.id)).not.toContain('circular economy event Stockholm');
    expect(plan.queries.enabled.map((c) => c.id)).not.toContain('circular economy event Stockholm');
  });

  it('lets a city turn a builtin blocked host off and add extras', () => {
    const plan = resolveEventDiscoveryPlan(
      'stockholm',
      emptyEventQueryOverlay(),
      overlayFromCityDiscovery({
        eventBlockConfig: {
          extraBlockDomains: ['noise.example'],
          disabledBlockDomains: ['facebook.com'],
        },
      })
    );
    const enabled = plan.blocks.enabled.map((c) => c.id);
    expect(enabled).toContain('noise.example');
    expect(enabled).not.toContain('facebook.com');
    expect(enabled).toContain('meetup.com');
    expect(plan.blocks.catalog.some((c) => c.id === 'facebook.com' && c.builtin)).toBeTrue();
  });

  it('reads eventQueries from a queue row and falls back to evidence', () => {
    expect(eventQueriesFromRow({
      eventQueries: ['repair cafe Stockholm'],
      candidate: { title: 'Repair Café' },
    })).toEqual(['repair cafe Stockholm']);
    expect(eventQueriesFromRow({
      evidence: [{ snippet: 'search snippet; query=loppis Stockholm evenemang; url=https://x' }],
    })).toEqual(['loppis Stockholm evenemang']);
  });
});
