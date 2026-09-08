import { formatPlaceAddressDisplay } from './place-address-display';

describe('formatPlaceAddressDisplay', () => {
  it('reorders city and CAP with no comma between street and number', () => {
    expect(formatPlaceAddressDisplay('Via Giuseppe Candiani 102, Milano, 20158')).toBe(
      'Via Giuseppe Candiani 102, 20158 Milano'
    );
  });

  it('keeps street number CAP city when already canonical', () => {
    expect(formatPlaceAddressDisplay('Via Canonica 74/11, 20154 Milano')).toBe(
      'Via Canonica 74/11, 20154 Milano'
    );
  });

  it('joins a comma between street and number', () => {
    expect(formatPlaceAddressDisplay('Via S. Tecla, 5, Milano, 20122', 'milan')).toBe(
      'Via S. Tecla 5, 20122 Milano'
    );
  });

  it('drops venue prefixes and country', () => {
    expect(
      formatPlaceAddressDisplay('Toys Center, Via F. Cavallotti 156, 20093 Cologno Monzese, Italy')
    ).toBe('Via F. Cavallotti 156, 20093 Cologno Monzese');
  });

  it('uses Milano as city fallback and maps English Milan', () => {
    expect(formatPlaceAddressDisplay('Viale Monza 9', 'milan')).toBe('Viale Monza 9, Milano');
    expect(formatPlaceAddressDisplay('Viale Stelvio 49, Milan')).toBe('Viale Stelvio 49, Milano');
  });

  it('leaves coordinate-only addresses unchanged', () => {
    expect(formatPlaceAddressDisplay('45.45164, 9.17340')).toBe('45.45164, 9.17340');
  });
});
