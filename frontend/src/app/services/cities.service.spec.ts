import {
  holdCitiesWhileReloading,
  readCachedCities,
  writeCachedCities,
  CITIES_CACHE_LS_KEY,
  type CityItem,
} from './cities.service';

describe('holdCitiesWhileReloading', () => {
  const stockholm: CityItem = { id: 'stockholm', name: 'Stockholm' } as CityItem;
  const milan: CityItem = { id: 'milan', name: 'Milan' } as CityItem;

  it('keeps the last city list while a reload emits empty', () => {
    expect(holdCitiesWhileReloading([stockholm], [])).toEqual([stockholm]);
  });

  it('takes a new non-empty list', () => {
    expect(holdCitiesWhileReloading([stockholm], [milan])).toEqual([milan]);
  });
});

describe('cities cache persistence', () => {
  const stockholm: CityItem = {
    id: 'stockholm',
    name: 'Stockholm',
    countryCode: 'SE',
    center: { lat: 59.325, lng: 18.072 },
  } as CityItem;

  beforeEach(() => {
    try { localStorage.removeItem(CITIES_CACHE_LS_KEY); } catch {}
  });

  afterEach(() => {
    try { localStorage.removeItem(CITIES_CACHE_LS_KEY); } catch {}
  });

  it('round-trips the last city list so reload can show the last name', () => {
    writeCachedCities([stockholm]);
    const cached = readCachedCities();
    expect(cached.length).toBe(1);
    expect(cached[0].id).toBe('stockholm');
    expect(cached[0].name).toBe('Stockholm');
    expect(cached[0].center).toEqual({ lat: 59.325, lng: 18.072 });
  });

  it('returns empty when nothing has been cached', () => {
    expect(readCachedCities()).toEqual([]);
  });
});
