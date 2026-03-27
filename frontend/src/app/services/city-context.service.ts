import { inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

const LS_KEY = 'circeco.cityId';
const DEFAULT_CITY_ID = 'stockholm';

@Injectable({ providedIn: 'root' })
export class CityContextService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly cityId = signal<string>(DEFAULT_CITY_ID);
  readonly cityId$ = toObservable(this.cityId);

  constructor() {
    // Initialize from URL or localStorage.
    queueMicrotask(() => this.syncFromUrlOrStorage(true));

    // Keep in sync on navigation.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.syncFromUrlOrStorage(false));
  }

  setCityId(next: string): void {
    const id = (next || '').trim().toLowerCase() || DEFAULT_CITY_ID;
    if (id === this.cityId()) return;

    this.cityId.set(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}

    // Persist in URL (non-destructive).
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { city: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private syncFromUrlOrStorage(firstRun: boolean): void {
    const qp = this.router.parseUrl(this.router.url).queryParams;
    const urlCity = typeof qp['city'] === 'string' ? String(qp['city']) : '';
    const fromUrl = urlCity.trim().toLowerCase();

    // We intentionally default to Stockholm unless the URL explicitly requests a city.
    // This avoids surprising users on first load if they previously selected another city.
    const next = fromUrl || DEFAULT_CITY_ID;

    if (next !== this.cityId()) {
      this.cityId.set(next);
    }

    // On first run, if URL is missing, write chosen default into URL.
    if (firstRun && !fromUrl) {
      try {
        localStorage.setItem(LS_KEY, next);
      } catch {}
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { city: next },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }
}

