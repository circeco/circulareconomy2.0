import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PhoneChromeService {
  readonly cityPickerOpen = signal(false);
  readonly atlasFavoritesOn = signal(false);
  readonly eventsFavoritesOn = signal(false);

  readonly atlasSavedToggle$ = new Subject<void>();
  readonly eventsSavedToggle$ = new Subject<void>();

  openCityPicker(): void {
    this.cityPickerOpen.set(true);
  }

  closeCityPicker(): void {
    this.cityPickerOpen.set(false);
  }

  toggleSaved(kind: 'atlas' | 'events'): void {
    if (kind === 'atlas') this.atlasSavedToggle$.next();
    else this.eventsSavedToggle$.next();
  }
}
