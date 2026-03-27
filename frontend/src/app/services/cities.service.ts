import { inject, Injectable } from '@angular/core';
import { Firestore, collection } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FS_PATHS } from '../data/firestore-paths';
import type { CityDoc } from '../data/models';

export type CityItem = CityDoc & { id: string };

@Injectable({ providedIn: 'root' })
export class CitiesService {
  private fs = inject(Firestore);

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
    shareReplay(1)
  );
}

