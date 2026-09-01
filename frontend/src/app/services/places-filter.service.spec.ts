import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { GeolocationService } from './geolocation.service';
import { Feature, PlacesFilter } from './places-filter.service';

function feat(name: string, lng: number, lat: number, extra: Record<string, unknown> = {}): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { STORE_NAME: name, ...extra } as any,
  };
}

describe('PlacesFilter nearby sort', () => {
  let filter: PlacesFilter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PlacesFilter, GeolocationService],
    });
    filter = TestBed.inject(PlacesFilter);
    filter.setActionTags(new Set(filter.ACTION_TAG_IDS));
    filter.setCategories(new Set());
  });

  it('keeps viewport order when origin is unset', async () => {
    const visible = [
      feat('Far', 18.2, 59.4),
      feat('Near', 18.08, 59.33),
    ];
    filter.setAllFeatures(visible);
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Far', 'Near']);
    expect(list[0].properties.distanceLabel).toBeUndefined();
  });

  it('sorts visible places nearest-first and labels distance', async () => {
    const origin = { lat: 59.325, lng: 18.072 };
    const visible = [
      feat('Far', 18.25, 59.42, { ACTION_TAGS: ['reuse'] }),
      feat('Near', 18.08, 59.33, { ACTION_TAGS: ['repair'] }),
    ];
    filter.setAllFeatures(visible);
    filter.setUserOrigin(origin);
    filter.setSortByDistance(true);
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Near', 'Far']);
    expect(list[0].properties.distanceLabel).toBeTruthy();
    expect(list[0].properties.distanceKm!).toBeLessThan(list[1].properties.distanceKm!);
  });

  it('follows the viewport even when sorting by distance', async () => {
    const origin = { lat: 59.325, lng: 18.072 };
    const far = feat('Far', 18.25, 59.42);
    const near = feat('Near', 18.08, 59.33);
    filter.setCityFeatures({ type: 'FeatureCollection', features: [far, near] });
    filter.setAllFeatures([far]);
    filter.setUserOrigin(origin);
    filter.setSortByDistance(true);
    const onlyVisible = await firstValueFrom(filter.filteredFeatures$);
    expect(onlyVisible.map((f) => f.properties.STORE_NAME)).toEqual(['Far']);

    filter.setAllFeatures([far, near]);
    const both = await firstValueFrom(filter.filteredFeatures$);
    expect(both.map((f) => f.properties.STORE_NAME)).toEqual(['Near', 'Far']);
  });

  it('keeps action-tag and search filters while sorting', async () => {
    const origin = { lat: 59.325, lng: 18.072 };
    const visible = [
      feat('Reuse shop', 18.08, 59.33, { ACTION_TAGS: ['reuse'], DESCRIPTION: 'clothes swap' }),
      feat('Repair cafe', 18.09, 59.331, { ACTION_TAGS: ['repair'], DESCRIPTION: 'fix bikes' }),
      feat('Other reuse', 18.25, 59.42, { ACTION_TAGS: ['reuse'], DESCRIPTION: 'furniture' }),
    ];
    filter.setAllFeatures(visible);
    filter.setUserOrigin(origin);
    filter.setSortByDistance(true);
    filter.setActionTags(new Set(['reuse']));
    filter.setFilter('clothes');
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Reuse shop']);
  });

  it('does not sort when sort-by-distance is off even if origin exists', async () => {
    const visible = [
      feat('Far', 18.2, 59.4),
      feat('Near', 18.08, 59.33),
    ];
    filter.setAllFeatures(visible);
    filter.setUserOrigin({ lat: 59.325, lng: 18.072 });
    filter.setSortByDistance(false);
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Far', 'Near']);
  });
});
