import { inject, Injectable, signal } from '@angular/core';
import { Firestore, collection } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FS_PATHS } from '../data/firestore-paths';
import type { CityDoc } from '../data/models';
import { CityContextService } from './city-context.service';

export type CityItem = CityDoc & { id: string };

export const CITIES_CACHE_LS_KEY = 'circeco.citiesCache';

/** Keep the last city list while Firestore reloads; do not flash an empty list. */
export function holdCitiesWhileReloading(displayed: CityItem[], next: CityItem[]): CityItem[] {
  return next.length > 0 ? next : displayed;
}

export function readCachedCities(): CityItem[] {
  try {
    const raw = localStorage.getItem(CITIES_CACHE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: unknown): c is CityItem => {
      if (!c || typeof c !== 'object') return false;
      const row = c as Partial<CityItem>;
      return typeof row.id === 'string' && !!row.id && typeof row.name === 'string' && !!row.name;
    }) as CityItem[];
  } catch {
    return [];
  }
}

export function writeCachedCities(rows: CityItem[]): void {
  try {
    if (!rows.length) return;
    const compact = rows.map((c) => ({
      id: c.id,
      name: c.name,
      countryCode: c.countryCode,
      center: c.center,
      enabled: c.enabled,
    }));
    localStorage.setItem(CITIES_CACHE_LS_KEY, JSON.stringify(compact));
  } catch {}
}

@Injectable({ providedIn: 'root' })
export class CitiesService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);
  private readonly _list = signal<CityItem[]>(readCachedCities());
  readonly list = this._list.asReadonly();

  readonly cities$: Observable<CityItem[]> = collectionData(
    collection(this.fs, FS_PATHS.cities),
    { idField: 'id' }
  ).pipe(
    map((docs) => {
      const all = docs as unknown as CityItem[];
      const enabled = all.filter((c) => (c as any)?.enabled !== false);
      return [...enabled].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }),
    catchError((err) => {
      console.warn('[cities] Firestore read failed; using empty list', err);
      return of([] as CityItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  private readonly keepListHot = this.cities$.subscribe((rows) => {
    const next = holdCitiesWhileReloading(this._list(), rows);
    this._list.set(next);
    if (rows.length) writeCachedCities(rows);
    this.syncStoredCityName(this.cityContext.cityId());
  });

  private readonly keepNameWithCity = this.cityContext.cityId$.subscribe((id) => {
    this.syncStoredCityName(id);
  });

  private syncStoredCityName(cityId: string): void {
    const match = this._list().find((c) => c.id === cityId);
    if (match?.name) this.cityContext.rememberCityName(match.name);
  }
}

