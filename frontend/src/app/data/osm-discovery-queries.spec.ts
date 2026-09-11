import {
  DEFAULT_OSM_CLAUSES,
  clausesFromQueueRow,
  normalizeOsmClause,
  resolveOsmClauses,
} from './osm-discovery-queries';

describe('osm-discovery-queries', () => {
  it('keeps the built-in Overpass allowlist', () => {
    const ids = DEFAULT_OSM_CLAUSES.map((c) => c.id);
    expect(ids).toContain('shop:second_hand');
    expect(ids).toContain('amenity:recycling_centre');
    expect(ids).toContain('name:libraccio');
    expect(ids).toContain('shop:antiques');
    expect(ids).toContain('shop:books+second_hand');
    expect(ids).toContain('shop:clothes+vintage');
    expect(ids).toContain('shop:bicycle+repair');
    expect(ids).not.toContain('shop:books');
  });

  it('rejects unsafe extra clauses', () => {
    expect(normalizeOsmClause({ kind: 'tag', key: 'shop', value: 'second_hand"];out;' })).toBeNull();
    expect(normalizeOsmClause({ kind: 'name_regex', key: 'shop', pattern: '.*' })).toBeNull();
    expect(normalizeOsmClause({ kind: 'tag', key: 'highway', value: 'bus_stop' })).toBeNull();
    expect(normalizeOsmClause({
      kind: 'and_tag',
      key: 'shop',
      value: 'clothes',
      andKey: 'organic',
      andValue: 'yes',
    })).toBeNull();
    expect(normalizeOsmClause({
      kind: 'and_tag',
      key: 'shop',
      value: 'clothes',
      andKey: 'vintage',
      andValue: 'yes',
    })?.id).toBe('shop:clothes+vintage');
  });

  it('lets a city disable a builtin and add a custom tag', () => {
    const resolved = resolveOsmClauses(
      {},
      {
        disabledClauseIds: ['shop:charity'],
        extraClauses: [{ kind: 'tag', key: 'shop', value: 'antiques' }],
      }
    );
    const ids = resolved.enabled.map((c) => c.id);
    expect(ids).not.toContain('shop:charity');
    expect(ids).toContain('shop:antiques');
  });

  it('lets a city remove a builtin from the catalog', () => {
    const resolved = resolveOsmClauses(
      {},
      { removedClauseIds: ['shop:charity'] }
    );
    const catalogIds = resolved.catalog.map((c) => c.id);
    expect(catalogIds).not.toContain('shop:charity');
    expect(resolved.enabled.map((c) => c.id)).not.toContain('shop:charity');
    expect(catalogIds).toContain('shop:second_hand');
  });

  it('reads osmClauses from a queue row and falls back to evidence', () => {
    expect(clausesFromQueueRow({
      osmClauses: ['shop:second_hand'],
      candidate: { name: 'Retro' },
    })).toEqual(['shop:second_hand']);
    expect(clausesFromQueueRow({
      evidence: [{ snippet: 'shop=books · amenity=recycling' }],
    })).toEqual(['shop:books', 'amenity:recycling']);
  });
});
