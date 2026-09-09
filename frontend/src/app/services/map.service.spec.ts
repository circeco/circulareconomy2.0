import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';

import { MapService } from './map.service';
import { ViewportService } from './viewport.service';

describe('MapService pedestrian streets', () => {
  let service: MapService;
  let layers: Set<string>;
  let added: { layer: any; before?: string }[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MapService, ViewportService, NgZone],
    });
    service = TestBed.inject(MapService);
    layers = new Set(['road-label-simple', 'road-simple']);
    added = [];
    (service as any).map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : null),
      getSource: (id: string) => (id === 'composite' ? { id } : null),
      getPaintProperty: () => undefined,
      getLayoutProperty: () => undefined,
      addLayer: (layer: any, before?: string) => {
        added.push({ layer, before });
        layers.add(layer.id);
      },
    };
  });

  it('adds pedestrian line and name layers under existing road labels', () => {
    (service as any).ensurePedestrianStreetLayers();

    expect(added.map((a) => a.layer.id)).toEqual(['road-pedestrian', 'road-label-pedestrian']);
    expect(added.every((a) => a.before === 'road-label-simple')).toBeTrue();

    const line = added[0].layer;
    expect(line.minzoom).toBe(14);
    expect(JSON.stringify(line.filter)).toContain('pedestrian');

    const labels = added[1].layer;
    expect(labels.minzoom).toBe(15);
    expect(labels.layout['symbol-placement']).toBe('line');
    expect(JSON.stringify(labels.filter)).toContain('pedestrian');
  });

  it('does not add the layers twice', () => {
    (service as any).ensurePedestrianStreetLayers();
    (service as any).ensurePedestrianStreetLayers();
    expect(added.length).toBe(2);
  });

  it('skips when the Studio road-label layer is missing', () => {
    layers.delete('road-label-simple');
    (service as any).ensurePedestrianStreetLayers();
    expect(added.length).toBe(0);
  });
});

describe('MapService search filter', () => {
  let service: MapService;
  let lastFilter: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MapService, ViewportService, NgZone],
    });
    service = TestBed.inject(MapService);
    lastFilter = undefined;
    (service as any).map = {
      getLayer: (id: string) => (id === 'places' ? { id } : null),
      setFilter: (_id: string, expr: any) => {
        lastFilter = expr;
      },
      setPaintProperty: () => {},
    };
  });

  it('constrains places to search keys and clears when search is off', () => {
    (service as any).applyFilters();
    expect(JSON.stringify(lastFilter)).not.toContain('PLACE_KEY');

    service.setSearchKeys(new Set(['addr|hornsgatan 104']));
    expect(JSON.stringify(lastFilter)).toContain('addr|hornsgatan 104');

    service.setSearchKeys(new Set());
    expect(lastFilter).toEqual(['==', ['literal', 1], 0]);

    service.setSearchKeys(null);
    expect(JSON.stringify(lastFilter)).not.toContain('PLACE_KEY');
  });
});
