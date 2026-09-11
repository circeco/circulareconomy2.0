import { mergeCityQueryParams } from './city-context.service';

describe('mergeCityQueryParams', () => {
  it('drops place and event when the city query param changes', () => {
    const next = mergeCityQueryParams(
      { city: 'milan', place: 'four-vintage', event: 'e1' },
      'stockholm'
    );
    expect(next).toEqual({ city: 'stockholm' });
  });

  it('keeps an intentional place when only adding missing city', () => {
    const next = mergeCityQueryParams({ place: 'four-vintage' }, 'milan');
    expect(next).toEqual({ place: 'four-vintage', city: 'milan' });
  });

  it('returns null when city is already on the URL', () => {
    expect(mergeCityQueryParams({ city: 'milan', place: 'four-vintage' }, 'milan')).toBeNull();
  });
});
