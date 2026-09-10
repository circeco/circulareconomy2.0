import { formatCityIdForDisplay, resolveCityDisplayName } from './city-display-name';

describe('formatCityIdForDisplay', () => {
  it('capitalizes a lowercase cityId', () => {
    expect(formatCityIdForDisplay('stockholm')).toBe('Stockholm');
    expect(formatCityIdForDisplay('milan')).toBe('Milan');
  });

  it('title-cases hyphenated or underscored slugs', () => {
    expect(formatCityIdForDisplay('new-york')).toBe('New York');
    expect(formatCityIdForDisplay('sao_paulo')).toBe('Sao Paulo');
  });

  it('returns empty for blank input', () => {
    expect(formatCityIdForDisplay('')).toBe('');
    expect(formatCityIdForDisplay('   ')).toBe('');
  });
});

describe('resolveCityDisplayName', () => {
  it('prefers the catalogue name', () => {
    expect(resolveCityDisplayName('stockholm', 'Stockholm', 'STO')).toBe('Stockholm');
  });

  it('uses the cached name when the list has no match', () => {
    expect(resolveCityDisplayName('stockholm', '', 'Stockholm')).toBe('Stockholm');
  });

  it('formats the cityId when list and cache are empty', () => {
    expect(resolveCityDisplayName('stockholm', '', '')).toBe('Stockholm');
  });
});
