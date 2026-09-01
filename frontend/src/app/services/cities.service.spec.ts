import { holdCitiesWhileReloading, type CityItem } from './cities.service';

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
