import { Injectable, signal } from '@angular/core';

import type { LatLng } from '../data/models';

export type GeoFix = { lat: number; lng: number; accuracy?: number };

export type GeoErrorCode = 'denied' | 'timeout' | 'unavailable' | 'unsupported' | 'insecure';

export type GeoResult =
  | { ok: true; fix: GeoFix }
  | { ok: false; code: GeoErrorCode };

export type CityLike = {
  id: string;
  name?: string;
  center: LatLng;
  bounds?: { sw: LatLng; ne: LatLng };
};

/** Fallback when a city has no `bounds`: within this distance of `center`. */
export const CITY_CENTER_RADIUS_KM = 40;

const USE_LOCATION_LS_KEY = 'circeco.useMyLocation';

function readUseMyLocation(): boolean {
  try {
    return localStorage.getItem(USE_LOCATION_LS_KEY) === '1';
  } catch {
    return false;
  }
}

const EARTH_RADIUS_KM = 6371;

/**
 * Browser geolocation for the atlas (nearby list + user puck).
 *
 * City policy: stay on the selected city. Never mix catalogues or auto-switch.
 * If GPS is inside another enabled city, the UI may prompt to switch.
 * "Inside" uses `city.bounds` when present, otherwise 40 km from `city.center`.
 * One-shot `getCurrentPosition` only — no watchPosition / background tracking.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Profile toggle: show nearby places on the Atlas. */
  readonly useMyLocation = signal(readUseMyLocation());

  setUseMyLocation(on: boolean): void {
    this.useMyLocation.set(on);
    try {
      localStorage.setItem(USE_LOCATION_LS_KEY, on ? '1' : '0');
    } catch {}
  }

  locate(options?: PositionOptions): Promise<GeoResult> {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return Promise.resolve({ ok: false, code: 'insecure' });
    }
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo?.getCurrentPosition) {
      return Promise.resolve({ ok: false, code: 'unsupported' });
    }

    const opts: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
      ...options,
    };

    return new Promise((resolve) => {
      geo.getCurrentPosition(
        (pos) => {
          resolve({
            ok: true,
            fix: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            },
          });
        },
        (err) => {
          if (err?.code === 1) resolve({ ok: false, code: 'denied' });
          else if (err?.code === 3) resolve({ ok: false, code: 'timeout' });
          else resolve({ ok: false, code: 'unavailable' });
        },
        opts
      );
    });
  }

  haversineKm(a: LatLng, b: LatLng): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  formatDistance(km: number): string {
    if (!isFinite(km) || km < 0) return '';
    if (km < 0.1) return '<100 m';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }

  pointInCity(point: LatLng, city: Pick<CityLike, 'center' | 'bounds'> | null | undefined): boolean {
    if (!point || !city?.center) return false;
    const bounds = city.bounds;
    if (bounds?.sw && bounds?.ne) {
      return (
        point.lat >= bounds.sw.lat &&
        point.lat <= bounds.ne.lat &&
        point.lng >= bounds.sw.lng &&
        point.lng <= bounds.ne.lng
      );
    }
    return this.haversineKm(point, city.center) <= CITY_CENTER_RADIUS_KM;
  }

  cityContaining<T extends CityLike>(point: LatLng, cities: T[]): T | null {
    const hits = (cities || []).filter((c) => this.pointInCity(point, c));
    if (!hits.length) return null;
    return hits.reduce((best, cur) => {
      const bestD = this.haversineKm(point, best.center);
      const curD = this.haversineKm(point, cur.center);
      return curD < bestD ? cur : best;
    });
  }
}
