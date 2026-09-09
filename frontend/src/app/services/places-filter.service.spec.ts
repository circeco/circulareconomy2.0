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

  it('matches search text in DESCRIPTION even when the listing hides it', async () => {
    const city = [
      feat('Verdandi', 18.08, 59.33, {
        ACTION_TAGS: ['reuse'],
        ADDRESS_LINE1: 'Hornsgatan 104',
        DESCRIPTION: 'second hand clothes and textiles',
      }),
      feat('Bike kitchen', 18.09, 59.331, {
        ACTION_TAGS: ['repair'],
        DESCRIPTION: 'fix your bicycle',
      }),
    ];
    // Rendered features omit DESCRIPTION (common from Mapbox queryRenderedFeatures).
    filter.setCityFeatures({ type: 'FeatureCollection', features: city });
    filter.setAllFeatures([
      feat('Verdandi', 18.08, 59.33, { ACTION_TAGS: ['reuse'], ADDRESS_LINE1: 'Hornsgatan 104' }),
      feat('Bike kitchen', 18.09, 59.331, { ACTION_TAGS: ['repair'] }),
    ]);
    filter.setFilter('textiles');
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Verdandi']);
  });

  it('does not pull city-only places into the list while searching', async () => {
    const inView = feat('Verdandi', 18.08, 59.33, {
      ACTION_TAGS: ['reuse'],
      ADDRESS_LINE1: 'Hornsgatan 104',
      DESCRIPTION: 'second hand clothes and textiles',
    });
    const offMap = feat('Textilverkstad', 18.2, 59.4, {
      ACTION_TAGS: ['reuse'],
      DESCRIPTION: 'textiles workshop',
    });
    filter.setCityFeatures({ type: 'FeatureCollection', features: [inView, offMap] });
    filter.setAllFeatures([
      feat('Verdandi', 18.08, 59.33, { ACTION_TAGS: ['reuse'], ADDRESS_LINE1: 'Hornsgatan 104' }),
    ]);
    filter.setFilter('textiles');
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Verdandi']);
  });

  it('exposes search match keys for the map from the city catalogue', async () => {
    const inView = feat('Verdandi', 18.08, 59.33, {
      ACTION_TAGS: ['reuse'],
      ADDRESS_LINE1: 'Hornsgatan 104',
      DESCRIPTION: 'second hand clothes and textiles',
    });
    const offMap = feat('Bike kitchen', 18.09, 59.331, {
      ACTION_TAGS: ['repair'],
      DESCRIPTION: 'fix your bicycle',
    });
    filter.setCityFeatures({ type: 'FeatureCollection', features: [inView, offMap] });
    filter.setAllFeatures([inView]);
    const idle = await firstValueFrom(filter.searchMatchKeys$);
    expect(idle).toBeNull();

    filter.setFilter('textiles');
    const keys = await firstValueFrom(filter.searchMatchKeys$);
    expect(keys).toBeTruthy();
    expect(keys!.size).toBe(1);
  });

  it('ANDs category, action, favourites, and search together', async () => {
    const keep = feat('Reuse apparel', 18.08, 59.33, {
      PLACE_KEY: 'keep',
      CATEGORY: 'apparel',
      ACTION_TAGS: ['reuse'],
      DESCRIPTION: 'clothes swap',
    });
    const wrongCategory = feat('Reuse electronics', 18.09, 59.331, {
      PLACE_KEY: 'electronics',
      CATEGORY: 'electronics',
      ACTION_TAGS: ['reuse'],
      DESCRIPTION: 'clothes gadgets',
    });
    const wrongAction = feat('Repair apparel', 18.10, 59.332, {
      PLACE_KEY: 'repair',
      CATEGORY: 'apparel',
      ACTION_TAGS: ['repair'],
      DESCRIPTION: 'clothes mend',
    });
    const notFav = feat('Other apparel reuse', 18.11, 59.333, {
      PLACE_KEY: 'not-fav',
      CATEGORY: 'apparel',
      ACTION_TAGS: ['reuse'],
      DESCRIPTION: 'clothes market',
    });
    const noSearch = feat('Reuse apparel silent', 18.12, 59.334, {
      PLACE_KEY: 'no-search',
      CATEGORY: 'apparel',
      ACTION_TAGS: ['reuse'],
      DESCRIPTION: 'furniture only',
    });
    const all = [keep, wrongCategory, wrongAction, notFav, noSearch];
    filter.setCityFeatures({ type: 'FeatureCollection', features: all });
    filter.setAllFeatures(all);
    filter.setCategories(new Set(['apparel']));
    filter.setActionTags(new Set(['reuse']));
    filter.setFavoriteKeys(new Set(['keep', 'electronics', 'repair', 'no-search']));
    filter.setFavoritesOnly(true);
    filter.setFilter('clothes');
    const list = await firstValueFrom(filter.filteredFeatures$);
    expect(list.map((f) => f.properties.STORE_NAME)).toEqual(['Reuse apparel']);
  });

  it('keeps search match keys stable when viewport features change', async () => {
    const inView = feat('Verdandi', 18.08, 59.33, {
      ACTION_TAGS: ['reuse'],
      ADDRESS_LINE1: 'Hornsgatan 104',
      DESCRIPTION: 'second hand clothes and textiles',
    });
    const offMap = feat('Bike kitchen', 18.09, 59.331, {
      ACTION_TAGS: ['repair'],
      DESCRIPTION: 'fix your bicycle',
    });
    const seen: Array<Set<string> | null> = [];
    const sub = filter.searchMatchKeys$.subscribe((keys) => seen.push(keys));
    filter.setCityFeatures({ type: 'FeatureCollection', features: [inView, offMap] });
    filter.setFilter('textiles');
    const afterSearch = seen.length;
    filter.setAllFeatures([inView]);
    filter.setAllFeatures([inView, offMap]);
    expect(seen.length).toBe(afterSearch);
    expect(seen[seen.length - 1]?.size).toBe(1);
    sub.unsubscribe();
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
