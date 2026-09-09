import {
  holdCitiesWhileReloading,
  readCachedCities,
  writeCachedCities,
  fallbackLiveCity,
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

describe('fallbackLiveCity', () => {
  const stockholm: CityItem = { id: 'stockholm', name: 'Stockholm' } as CityItem;
  const milan: CityItem = { id: 'milan', name: 'Milan' } as CityItem;

  it('keeps a live current city', () => {
    expect(fallbackLiveCity([milan, stockholm], 'milan')?.id).toBe('milan');
  });

  it('falls back to Stockholm when the current city is paused', () => {
    expect(fallbackLiveCity([milan, stockholm], 'uppsala')?.id).toBe('stockholm');
  });

  it('uses the first live city if Stockholm is not in the list', () => {
    expect(fallbackLiveCity([milan], 'turin')?.id).toBe('milan');
  });

  it('returns null when no cities are live', () => {
    expect(fallbackLiveCity([], 'stockholm')).toBeNull();
  });
});
