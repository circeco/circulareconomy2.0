import { inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

const LS_KEY = 'circeco.cityId';
const DEFAULT_CITY_ID = 'stockholm';

function readStoredCityId(): string {
  try {
    return String(localStorage.getItem(LS_KEY) || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

@Injectable({ providedIn: 'root' })
export class CityContextService {
  private router = inject(Router);
  private initialized = false;

  readonly cityId = signal<string>(readStoredCityId() || DEFAULT_CITY_ID);
  readonly cityId$ = toObservable(this.cityId);

  constructor() {
    // Keep in sync on navigation; first NavigationEnd is treated as initial sync.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.syncFromUrlOrStorage();
        this.initialized = true;
      });

    // Fallback for cases where Router is already navigated before this service is created.
    queueMicrotask(() => {
      if (!this.initialized && this.router.navigated) {
        this.syncFromUrlOrStorage();
        this.initialized = true;
      }
    });
  }

  /**
   * Merge `city` into the current URL without changing the path.
   * Do NOT use `navigate([], { relativeTo: ActivatedRoute })` from a root service — the injected
   * route is the router root, so `[]` resolves to `/` and kicks users off `/admin/*` etc.
   */
  private mergeCityIntoCurrentUrl(cityId: string): void {
    const tree = this.router.parseUrl(this.router.url);
    if (tree.queryParams['city'] === cityId) return;
    tree.queryParams = { ...tree.queryParams, city: cityId };
    this.router.navigateByUrl(tree, { replaceUrl: true });
  }

  private persistCityId(id: string): void {
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}
  }

  setCityId(next: string): void {
    const id = (next || '').trim().toLowerCase() || DEFAULT_CITY_ID;
    if (id === this.cityId()) return;

    this.cityId.set(id);
    this.persistCityId(id);
    this.mergeCityIntoCurrentUrl(id);
  }

  private syncFromUrlOrStorage(): void {
    const qp = this.router.parseUrl(this.router.url).queryParams;
    const urlCity = typeof qp['city'] === 'string' ? String(qp['city']) : '';
    const fromUrl = urlCity.trim().toLowerCase();
    const stored = readStoredCityId();
    const next = fromUrl || stored || this.cityId() || DEFAULT_CITY_ID;

    if (next !== this.cityId()) {
      this.cityId.set(next);
    }
    this.persistCityId(next);

    // Keep city on the URL across in-app navigations that drop query params.
    if (!fromUrl) {
      this.mergeCityIntoCurrentUrl(next);
    }
  }
}
