import { inject, Injectable, signal } from '@angular/core';
import { Firestore, collection } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FS_PATHS } from '../data/firestore-paths';
import type { CityDoc } from '../data/models';

export type CityItem = CityDoc & { id: string };

/** Keep the last city list while Firestore reloads; do not flash an empty list. */
export function holdCitiesWhileReloading(displayed: CityItem[], next: CityItem[]): CityItem[] {
  return next.length > 0 ? next : displayed;
}

@Injectable({ providedIn: 'root' })
export class CitiesService {
  private fs = inject(Firestore);
  private readonly _list = signal<CityItem[]>([]);
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
    this._list.set(holdCitiesWhileReloading(this._list(), rows));
  });
}

