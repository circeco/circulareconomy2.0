import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { FavoritesService } from '../services/favorites.service';
import { MapService } from '../services/map.service';
import { PlacesFilter } from '../services/places-filter.service';

export class AuthServiceStub implements Pick<AuthService, 'user$' | 'modalOpen' | 'openModal' | 'closeModal' | 'signInOnce' | 'signUpOnce' | 'signOutOnce' | 'resetPasswordOnce' | 'isAuthenticated' | 'isAdmin'> {
  user$ = of(null);
  modalOpen = signal(false);

  openModal = () => this.modalOpen.set(true);
  closeModal = () => this.modalOpen.set(false);

  signInOnce = async (_email: string, _password: string) => Promise.resolve({} as any);
  signUpOnce = async (_email: string, _password: string) => Promise.resolve({} as any);
  signOutOnce = async () => Promise.resolve();
  resetPasswordOnce = async (_email: string) => Promise.resolve();

  isAuthenticated = () => of(false);
  isAdmin = () => of(false);
}

export class FavoritesServiceStub implements Partial<FavoritesService> {
  mountHeartButton(_btn: HTMLButtonElement, _placeOrFeature: any) { return Promise.resolve(); }
  buildPlaceFromFeature() { return null as any; }
  computePlaceKey() { return '' as any; }
}

export class MapServiceStub implements Pick<MapService, 'init' | 'onReady' | 'queryRenderedFeatures$' | 'onFeatureClick' | 'onLocateClick' | 'openPopup' | 'flyTo' | 'flyToCity' | 'setPlacesData' | 'setFavoritesVisibility' | 'setCategoryFilter' | 'setActionTagFilter' | 'showUserLocation' | 'clearUserLocation' | 'resize' | 'destroy'> {
  private ready$ = new Subject<boolean>();
  private features$ = new Subject<any[]>();
  private click$ = new Subject<{ feature: any; coords: [number, number] }>();
  private locate$ = new Subject<void>();

  init() { this.ready$.next(true); }
  onReady() { return this.ready$.asObservable(); }
  queryRenderedFeatures$() { return this.features$.asObservable(); }
  onFeatureClick() { return this.click$.asObservable(); }
  onLocateClick() { return this.locate$.asObservable(); }

  openPopup() {}
  flyTo() {}
  flyToCity() {}
  setPlacesData() {}
  setFavoritesVisibility(_v: boolean) {}
  setCategoryFilter(_set: Set<string>) {}
  setActionTagFilter(_set: Set<string>) {}
  showUserLocation() {}
  clearUserLocation() {}
  resize() {}
  destroy() {}
}

export class PlacesFilterStub implements Partial<PlacesFilter> {
  CATEGORY_IDS: string[] = [];
  ACTION_TAG_IDS: string[] = [];
  enabledCategories$ = of(new Set<string>());
  enabledActionTagsState$ = of(new Set<string>());
  filteredFeatures$ = of([]);

  setAllFeatures(_features: any) {}
  setCityFeatures(_fc: any) {}
  setFilter(_query: string) {}
  setCategories(_set: Set<string>) {}
  setActionTags(_set: Set<string>) {}
  setUserOrigin(_origin: any) {}
  setSortByDistance(_on: boolean) {}
  setFavoriteKeys(_keys: Set<string>) {}
  setFavoritesOnly(_on: boolean) {}
  enrichForUI(_feature: any) { return {} as any; }
  buildIndex(_fc: any) {}
}
