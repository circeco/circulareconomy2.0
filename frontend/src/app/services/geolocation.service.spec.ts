import { GeolocationService, CITY_CENTER_RADIUS_KM } from './geolocation.service';

describe('GeolocationService', () => {
  let geo: GeolocationService;

  beforeEach(() => {
    geo = new GeolocationService();
  });

  it('maps permission denied to denied', async () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((_ok, err) => {
      err?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
    const result = await geo.locate();
    expect(result).toEqual({ ok: false, code: 'denied' });
  });

  it('maps timeout to timeout', async () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((_ok, err) => {
      err?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
    const result = await geo.locate();
    expect(result).toEqual({ ok: false, code: 'timeout' });
  });

  it('maps other errors to unavailable', async () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((_ok, err) => {
      err?.({ code: 2, message: 'unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
    const result = await geo.locate();
    expect(result).toEqual({ ok: false, code: 'unavailable' });
  });

  it('returns a fix on success', async () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((ok) => {
      ok({
        coords: { latitude: 59.33, longitude: 18.07, accuracy: 12 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    const result = await geo.locate();
    expect(result).toEqual({ ok: true, fix: { lat: 59.33, lng: 18.07, accuracy: 12 } });
  });

  it('computes haversine distance between nearby points', () => {
    const km = geo.haversineKm({ lat: 59.325, lng: 18.072 }, { lat: 59.335, lng: 18.072 });
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.3);
  });

  it('formats distances for list rows', () => {
    expect(geo.formatDistance(0.04)).toBe('<100 m');
    expect(geo.formatDistance(0.45)).toBe('450 m');
    expect(geo.formatDistance(3.24)).toBe('3.2 km');
    expect(geo.formatDistance(18.6)).toBe('19 km');
  });

  it('uses bounds when present', () => {
    const city = {
      id: 'stockholm',
      center: { lat: 59.325, lng: 18.072 },
      bounds: { sw: { lat: 59.2, lng: 17.8 }, ne: { lat: 59.45, lng: 18.3 } },
    };
    expect(geo.pointInCity({ lat: 59.33, lng: 18.07 }, city)).toBeTrue();
    expect(geo.pointInCity({ lat: 45.46, lng: 9.19 }, city)).toBeFalse();
  });

  it('falls back to 40 km from center when bounds are missing', () => {
    const city = { id: 'milan', center: { lat: 45.4642, lng: 9.19 } };
    expect(geo.pointInCity({ lat: 45.47, lng: 9.2 }, city)).toBeTrue();
    expect(geo.pointInCity({ lat: 59.33, lng: 18.07 }, city)).toBeFalse();
    const justInside = geo.haversineKm(city.center, { lat: 45.4642, lng: 9.19 });
    expect(justInside).toBeLessThan(CITY_CENTER_RADIUS_KM);
  });

  it('picks the closest city when the point is in more than one', () => {
    const cities = [
      { id: 'stockholm', name: 'Stockholm', center: { lat: 59.325, lng: 18.072 } },
      { id: 'uppsala', name: 'Uppsala', center: { lat: 59.858, lng: 17.639 } },
    ];
    const hit = geo.cityContaining({ lat: 59.33, lng: 18.08 }, cities);
    expect(hit?.id).toBe('stockholm');
  });
});
