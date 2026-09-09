import { Injectable, NgZone } from '@angular/core';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { environment } from '../../environments/environments';
import { ACTION_TAG_COLORS, ACTION_TAGS } from '../data/taxonomy';
import { ViewportService } from './viewport.service';

declare const mapboxgl: any;

@Injectable({ providedIn: 'root' })
export class MapService {
  private map: any;
  private loaded = false;                // style rendered at least once
  private placesReady = false;           // geojson source fully loaded

  private favoriteKeys = new Set<string>();
  private favoritesVisible = false;
  private lastCategorySet = new Set<string>();
  private readonly allActionTags = ACTION_TAGS.slice();
  private lastActionTagSet = new Set<string>(this.allActionTags);
  /** Matching PLACE_KEYs while searching; null means search is off. */
  private searchKeys: Set<string> | null = null;
  private readonly baseColor = 'rgb(69,129,142)';
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;

  private ready$ = new ReplaySubject<boolean>(1); // emits when BOTH are true
  private click$ = new Subject<{ feature: any; coords: [number, number] }>();
  private locateClick$ = new Subject<void>();
  private userLocationReady = false;
  private userMarker: any = null;

  private readonly STOCKHOLM: [number, number] = [18.072, 59.325];
  private readonly EMPTY_FC: { type: 'FeatureCollection'; features: any[] } = {
    type: 'FeatureCollection',
    features: [],
  };
  private pendingPlacesData: { type: 'FeatureCollection'; features: any[] } = this.EMPTY_FC;
  private pendingCityCenter: [number, number] | null = null;
  /** Props of the place whose popup is open — used to dismiss when filters hide it. */
  private openPopupProps: Record<string, unknown> | null = null;

  constructor(
    private zone: NgZone,
    private viewport: ViewportService
  ) { }

  onReady(): Observable<boolean> { return this.ready$.asObservable(); }
  onFeatureClick(): Observable<{ feature: any; coords: [number, number] }> { return this.click$.asObservable(); }
  onLocateClick(): Observable<void> { return this.locateClick$.asObservable(); }

  init(container: HTMLElement) {
    if (typeof mapboxgl === 'undefined') {
      console.error('[map] mapboxgl global not found (CDN missing).');
      return;
    }
    mapboxgl.accessToken = (environment as any)?.mapboxToken
      || 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

    this.syncFavoriteKeysFromGlobal();

    this.zone.runOutsideAngular(() => {
      this.map = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
        center: this.STOCKHOLM,
        zoom: 10
      });

      this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      this.addLocateControl();
      this.map.on('styleimagemissing', (e: any) => { if (!e.id) return; });

      (window as any).circeco = (window as any).circeco || {};
      (window as any).circeco.map = this.map;
      if (!(window as any).circeco.openAuthModal) (window as any).circeco.openAuthModal = () => { };

      this.map.on('load', () => this.onLoad());
    });

    window.addEventListener('favorites:update', this.onFavoritesUpdate);
  }

  private onLoad() {
    try {
      // Monochrome-based Studio style omits OSM highway=pedestrian from road lines/labels.
      this.ensurePedestrianStreetLayers();
      if (!this.getSource('places')) {
        this.map.addSource('places', { type: 'geojson', data: this.EMPTY_FC });
      }
      if (!this.getLayer('places')) {
        this.map.addLayer({
          id: 'places', type: 'circle', source: 'places',
          layout: { visibility: 'visible' },
          paint: {
            'circle-radius': this.placeCircleRadius(),
            'circle-color': this.baseColor
          }
        });
      }

      if (!this.getSource('favorites')) {
        this.map.addSource('favorites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      if (!this.getLayer('favorites')) {
        this.map.addLayer({
          id: 'favorites', type: 'circle', source: 'favorites',
          layout: { visibility: 'none' },
          paint: { 'circle-radius': this.placeCircleRadius(), 'circle-color': '#FF5252' }
        });
      }
      this.ensureUserLocationLayers();
      // Apply latest queued places once source exists.
      this.setPlacesData(this.pendingPlacesData);
      if (this.pendingCityCenter) {
        if (this.map.jumpTo) this.map.jumpTo({ center: this.pendingCityCenter, zoom: 11 });
        else this.map.flyTo({ center: this.pendingCityCenter, zoom: 11, duration: 0 });
      }
      this.syncFavoriteKeysFromGlobal();
      this.applyFilters(); // ensures stored favorites recolor once layers exist
      window.dispatchEvent(new Event('map:favorites-source-ready'));
    } catch (e) {
      console.error('[map] failed adding sources/layers', e);
    }

    // mark "style rendered once"
    this.map.once('idle', () => {
      this.loaded = true;
      this.wireClickAndHover(); // <-- add interactions when the style is ready
      this.maybeReady();
    });

    // mark "places source loaded"
    const onSourceData = (e: any) => {
      if (e?.sourceId === 'places' && this.map.isSourceLoaded('places')) {
        this.placesReady = true;
        this.maybeReady();
        this.map.off('sourcedata', onSourceData);
      }
    };
    this.map.on('sourcedata', onSourceData);
  }

  private maybeReady() {
    if (this.loaded && this.placesReady) {
      this.ready$.next(true);
      this.ready$.complete();
    }
  }

  // --- interactions: click + hover pointer ---
  private wireClickAndHover() {
    const layers = () => this.existingVisibleLayers(['places', 'favorites']);
    this.applyPlaceCircleRadius();

    this.map.on('click', (e: any) => {
      const ids = layers();
      if (!ids.length) return;

      const feats = this.queryFeaturesNearPoint(e.point, ids);
      if (!feats.length) return;

      const best = this.nearestFeature(feats, e.point) || feats[0];

      // popup coordinates (handle antimeridian)
      const coords: [number, number] = best?.geometry?.coordinates
        ? (best.geometry.coordinates.slice() as [number, number])
        : [e.lngLat.lng, e.lngLat.lat];

      while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
        coords[0] += (e.lngLat.lng > coords[0] ? 360 : -360);
      }

      this.click$.next({ feature: best, coords });
    });

    this.map.on('mousemove', (e: any) => {
      const ids = layers();
      const feats = ids.length ? this.queryFeaturesNearPoint(e.point, ids) : [];
      this.map.getCanvas().style.cursor = (feats && feats.length) ? 'pointer' : '';
    });
  }

  private placeCircleRadius(): number {
    return this.viewport.isPhone() ? 6 : 5;
  }

  private tapPadPx(): number {
    return this.viewport.isPhone() ? 28 : 14;
  }

  private applyPlaceCircleRadius(): void {
    const radius = this.placeCircleRadius();
    for (const id of ['places', 'favorites']) {
      if (this.getLayer(id)) this.map.setPaintProperty(id, 'circle-radius', radius);
    }
  }

  private queryFeaturesNearPoint(point: { x: number; y: number }, layerIds: string[]): any[] {
    if (!this.map?.queryRenderedFeatures) return [];
    const pad = this.tapPadPx();
    const bbox: [[number, number], [number, number]] = [
      [point.x - pad, point.y - pad],
      [point.x + pad, point.y + pad],
    ];
    return this.map.queryRenderedFeatures(bbox, { layers: layerIds }) || [];
  }

  private nearestFeature(feats: any[], point: { x: number; y: number }): any {
    if (!feats.length) return null;
    if (feats.length === 1 || !this.map?.project) return feats[0];
    let best = feats[0];
    let bestD = Infinity;
    for (const f of feats) {
      const coords = f?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const p = this.map.project(coords);
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  // ---------- Safe helpers ----------
  private getLayer(id: string) {
    return this.map?.getLayer?.(id) || null;
  }
  private getSource(id: string) {
    return this.map?.getSource?.(id) || null;
  }
  private getLayoutProperty(id: string, prop: string) {
    return this.map?.getLayoutProperty?.(id, prop);
  }
  private existingLayers(ids: string[]) {
    return ids.filter(id => !!this.getLayer(id));
  }
  private existingVisibleLayers(ids: string[]) {
    return ids.filter(id => {
      const lyr = this.getLayer(id);
      if (!lyr) return false;
      return this.getLayoutProperty(id, 'visibility') !== 'none';
    });
  }

  // ---------- Public API (safe) ----------
  setCategoryFilter(enabled: Set<string>) {
    this.lastCategorySet = new Set(enabled);
    this.applyFilters();
    this.closePopupIfFilteredOut();
  }

  setActionTagFilter(enabled: Set<string>) {
    this.lastActionTagSet = new Set(enabled);
    this.applyFilters();
    this.closePopupIfFilteredOut();
  }

  setSearchKeys(keys: Set<string> | null) {
    if (this.sameKeySet(this.searchKeys, keys)) return;
    this.searchKeys = keys ? new Set(keys) : null;
    this.applyFilters();
    this.closePopupIfFilteredOut();
  }

  setFavoritesVisibility(v: boolean) {
    this.favoritesVisible = v;
    if (this.getLayer('favorites')) {
      this.map.setLayoutProperty('favorites', 'visibility', 'none');
    }
    this.applyFilters();
    this.applyPaint();
    this.closePopupIfFilteredOut();
  }

  queryRenderedFeatures$(layers: string[] = ['places', 'favorites']): Observable<any[]> {
    return new Observable(sub => {
      let rafId = 0;
      let retries = 0;

      const emit = () => {
        try {
          const ids = this.existingLayers(layers);
          if (!ids.length) { sub.next([]); return; }
          const feats = this.map.queryRenderedFeatures({ layers: ids }) || [];
          sub.next(feats);

          if ((!feats || feats.length === 0) && retries < 6) {
            retries++;
            rafId = requestAnimationFrame(emit);
          } else {
            retries = 0;
          }
        } catch {
          sub.next([]);
        }
      };

      const start = () => {
        rafId = requestAnimationFrame(emit);
        this.map.on('idle', emit);
        this.map.on('moveend', emit);
        this.map.on('zoomend', emit);
        this.map.on('rotateend', emit);
        this.map.on('pitchend', emit);
      };

      if (this.loaded && this.placesReady) start();
      else this.onReady().subscribe({ next: () => start() });

      return () => {
        cancelAnimationFrame(rafId);
        this.map.off('idle', emit);
        this.map.off('moveend', emit);
        this.map.off('zoomend', emit);
        this.map.off('rotateend', emit);
        this.map.off('pitchend', emit);
      };
    });
  }

  showUserLocation(lng: number, lat: number, accuracyMeters?: number, flyToUser = false) {
    if (!this.map) return;
    this.ensureUserLocationLayers();
    if (!this.userMarker) {
      const el = document.createElement('img');
      el.className = 'circeco-user-marker';
      el.src = '/assets/icons/user-location.png';
      el.alt = 'Your location';
      el.width = 36;
      el.height = 36;
      this.userMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(this.map);
    } else {
      this.userMarker.setLngLat([lng, lat]);
    }
    const radius = typeof accuracyMeters === 'number' && isFinite(accuracyMeters) && accuracyMeters > 0
      ? accuracyMeters
      : 0;
    this.getSource('user-accuracy')?.setData?.(
      radius ? this.accuracyCircleFc(lng, lat, radius) : this.EMPTY_FC
    );
    if (flyToUser) {
      this.map.flyTo({ center: [lng, lat], zoom: 14 });
    }
  }

  clearUserLocation() {
    this.userMarker?.remove();
    this.userMarker = null;
    this.getSource('user-accuracy')?.setData?.(this.EMPTY_FC);
  }

  flyTo(center: [number, number], zoom = 14) {
    if (!this.map?.flyTo) return;
    this.map.flyTo({ center, zoom });
  }

  /** Instant city camera — do not leave the previous city on screen while GeoJSON loads. */
  jumpToCity(center: [number, number], zoom = 11) {
    this.pendingCityCenter = center;
    if (!this.map) return;
    if (this.map.jumpTo) this.map.jumpTo({ center, zoom });
    else if (this.map.flyTo) this.map.flyTo({ center, zoom, duration: 0 });
  }

  flyToCity(center: [number, number], zoom = 11) {
    this.pendingCityCenter = center;
    if (!this.map?.flyTo) return;
    this.map.flyTo({ center, zoom });
  }

  clearPlaces() {
    this.setPlacesData(this.EMPTY_FC);
    this.closePopup();
  }

  closePopup() {
    this.openPopupProps = null;
    document.querySelector('.mapboxgl-popup')?.remove();
  }

  setPlacesData(fc: { type: 'FeatureCollection'; features: any[] }) {
    const features = (fc?.features || []).map((f: any) => {
      const props = f?.properties || {};
      const coords = (f?.geometry?.coordinates || []) as [number, number];
      const key = this.computePlaceKey(props, coords, f?.id);
      if (key && !props.PLACE_KEY) props.PLACE_KEY = key;
      return { ...f, properties: props };
    });
    const next = { type: 'FeatureCollection' as const, features };
    this.pendingPlacesData = next;
    const src = this.getSource('places');
    if (src?.setData) src.setData(next);
    this.closePopupIfPlaceGone(features);
  }

  openPopup(center: [number, number], content: HTMLElement, props?: Record<string, unknown> | null) {
    this.closePopup();
    this.openPopupProps = props ? { ...props } : null;
    const popup = new mapboxgl.Popup({ closeOnClick: true })
      .setLngLat(center)
      .setDOMContent(content)
      .addTo(this.map);
    popup.on('close', () => {
      this.openPopupProps = null;
    });
  }

  resize() { this.map?.resize(); }
  destroy() {
    window.removeEventListener('favorites:update', this.onFavoritesUpdate);
    this.closePopup();
    this.userMarker?.remove();
    this.userMarker = null;
    this.map?.remove(); this.map = null; this.loaded = false; this.placesReady = false;
    this.userLocationReady = false;
    this.pendingPlacesData = this.EMPTY_FC;
    this.pendingCityCenter = null;
  }

  private addLocateControl() {
    const self = this;
    const control = {
      onAdd() {
        const container = document.createElement('div');
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group circeco-locate-ctrl';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mapboxgl-ctrl-icon circeco-locate-btn';
        btn.setAttribute('aria-label', 'Show nearby places');
        btn.title = 'Show nearby places';
        btn.addEventListener('click', (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
          self.zone.run(() => self.locateClick$.next());
        });
        container.appendChild(btn);
        (this as any)._container = container;
        return container;
      },
      onRemove() {
        const el = (this as any)._container as HTMLElement | undefined;
        el?.parentNode?.removeChild(el);
      },
    };
    this.map.addControl(control, 'bottom-right');
  }

  /**
   * The Circeco Studio style only labels motorway…street_limited.
   * OSM pedestrian streets (piazzas, shopping streets) are class=pedestrian and stay unnamed
   * unless we add them here. Names appear from zoom 15 so city-scale stays uncluttered.
   */
  private ensurePedestrianStreetLayers() {
    if (!this.map || this.getLayer('road-label-pedestrian')) return;
    if (!this.getSource('composite') || !this.getLayer('road-label-simple')) return;

    const beforeId = 'road-label-simple';
    const pedestrianLine: any[] = [
      'all',
      ['match', ['get', 'class'], ['pedestrian'], true, false],
      ['match', ['get', 'structure'], ['none', 'ford', 'bridge'], true, false],
      ['==', ['geometry-type'], 'LineString'],
    ];
    const pedestrianLabel: any[] = [
      'all',
      ['match', ['get', 'class'], ['pedestrian'], true, false],
      ['==', ['geometry-type'], 'LineString'],
    ];

    try {
      if (!this.getLayer('road-pedestrian')) {
        this.map.addLayer({
          id: 'road-pedestrian',
          type: 'line',
          source: 'composite',
          'source-layer': 'road',
          minzoom: 14,
          filter: pedestrianLine,
          layout: {
            'line-cap': ['step', ['zoom'], 'butt', 14, 'round'],
            'line-join': ['step', ['zoom'], 'miter', 14, 'round'],
          },
          paint: {
            'line-color': this.map.getPaintProperty?.('road-simple', 'line-color') || 'hsl(185, 3%, 100%)',
            'line-width': [
              'interpolate',
              ['exponential', 1.5],
              ['zoom'],
              13, 0.5,
              18, 7,
            ],
          },
        }, beforeId);
      }

      this.map.addLayer({
        id: 'road-label-pedestrian',
        type: 'symbol',
        source: 'composite',
        'source-layer': 'road',
        minzoom: 15,
        filter: pedestrianLabel,
        layout: {
          'text-size': this.map.getLayoutProperty?.('road-label-simple', 'text-size')
            || ['interpolate', ['linear'], ['zoom'], 10, 8.1, 18, 12.6],
          'text-max-angle': 30,
          'text-font': this.map.getLayoutProperty?.('road-label-simple', 'text-font')
            || ['Khand Regular', 'Arial Unicode MS Regular'],
          'symbol-placement': 'line',
          'text-padding': 1,
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-letter-spacing': 0.01,
        },
        paint: {
          'text-color': this.map.getPaintProperty?.('road-label-simple', 'text-color') || 'hsl(185, 3%, 47%)',
          'text-halo-color': this.map.getPaintProperty?.('road-label-simple', 'text-halo-color') || 'hsl(185, 1%, 100%)',
          'text-halo-width': this.map.getPaintProperty?.('road-label-simple', 'text-halo-width') ?? 1,
        },
      }, beforeId);
    } catch (e) {
      console.error('[map] failed adding pedestrian street layers', e);
    }
  }

  private ensureUserLocationLayers() {
    if (!this.map || this.userLocationReady) return;
    try {
      if (!this.getSource('user-accuracy')) {
        this.map.addSource('user-accuracy', { type: 'geojson', data: this.EMPTY_FC });
      }
      if (!this.getLayer('user-accuracy')) {
        this.map.addLayer({
          id: 'user-accuracy',
          type: 'fill',
          source: 'user-accuracy',
          paint: {
            'fill-color': '#45818e',
            'fill-opacity': 0.18,
          },
        });
      }
      this.userLocationReady = true;
    } catch (e) {
      console.error('[map] failed adding user location layers', e);
    }
  }

  private accuracyCircleFc(lng: number, lat: number, radiusMeters: number) {
    const steps = 64;
    const coords: [number, number][] = [];
    const latRad = (lat * Math.PI) / 180;
    const mPerDegLat = 110540;
    const mPerDegLng = 111320 * Math.cos(latRad);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      coords.push([
        lng + (radiusMeters * Math.cos(a)) / mPerDegLng,
        lat + (radiusMeters * Math.sin(a)) / mPerDegLat,
      ]);
    }
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      }],
    };
  }

  setFavoriteKeys(keys: Set<string>) {
    const next = new Set(keys);
    if (this.sameKeySet(this.favoriteKeys, next)) return;
    this.favoriteKeys = next;
    this.applyFilters();
    this.applyPaint();
  }

  private applyFilters() {
    const tests: any[] = [];
    this.lastCategorySet.forEach(cat => {
      tests.push(['in', cat, ['coalesce', ['get', 'CATEGORIES'], ['literal', []]]]);
      tests.push(['==', ['get', 'CATEGORY'], cat]);
    });
    const favList = Array.from(this.favoriteKeys);
    let expr: any = this.lastCategorySet.size ? ['any', ...tests] : ['==', ['literal', 1], 1];

    if (this.favoritesVisible) {
      if (favList.length) {
        expr = ['all', expr, ['in', ['get', 'PLACE_KEY'], ['literal', favList]]];
      } else {
        expr = ['==', ['literal', 1], 0];
      }
    }

    const shouldApplyActionFilter =
      this.lastActionTagSet.size > 0 && this.lastActionTagSet.size < this.allActionTags.length;
    if (shouldApplyActionFilter) {
      const actionTests: any[] = [];
      this.lastActionTagSet.forEach((tag) => {
        actionTests.push(['in', tag, ['coalesce', ['get', 'ACTION_TAGS'], ['literal', []]]]);
        actionTests.push(['in', tag, ['coalesce', ['get', 'actionTags'], ['literal', []]]]);
        actionTests.push(['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], '']], tag]);
        actionTests.push(['==', ['downcase', ['coalesce', ['get', 'actionTag'], '']], tag]);
      });
      expr = ['all', expr, ['any', ...actionTests]];
    } else if (!this.lastActionTagSet.size) {
      expr = ['==', ['literal', 1], 0];
    }

    if (this.searchKeys) {
      const searchList = Array.from(this.searchKeys);
      if (searchList.length) {
        expr = ['all', expr, ['in', ['get', 'PLACE_KEY'], ['literal', searchList]]];
      } else {
        expr = ['==', ['literal', 1], 0];
      }
    }

    if (this.getLayer('places')) {
      this.map.setFilter('places', expr);
    }
    this.applyPaint();
  }

  /** Drop popup when the open place no longer passes category / action / favorites / search filters. */
  private closePopupIfFilteredOut(): void {
    if (!this.openPopupProps) return;
    if (!this.placePassesCurrentFilters(this.openPopupProps)) {
      this.closePopup();
    }
  }

  /** Drop popup when the open place is no longer in the loaded catalogue (city switch, etc.). */
  private closePopupIfPlaceGone(features: any[]): void {
    if (!this.openPopupProps) return;
    const openKey = String(this.openPopupProps['PLACE_KEY'] || '');
    if (!openKey) {
      this.closePopup();
      return;
    }
    const stillThere = features.some((f) => String(f?.properties?.PLACE_KEY || '') === openKey);
    if (!stillThere) this.closePopup();
  }

  private placePassesCurrentFilters(props: Record<string, unknown>): boolean {
    if (this.lastCategorySet.size) {
      const categories = Array.isArray(props['CATEGORIES']) ? (props['CATEGORIES'] as string[]) : [];
      const category = String(props['CATEGORY'] || '');
      const catOk = Array.from(this.lastCategorySet).some(
        (cat) => categories.includes(cat) || category === cat
      );
      if (!catOk) return false;
    }

    if (!this.lastActionTagSet.size) return false;
    if (this.lastActionTagSet.size < this.allActionTags.length) {
      const tags = [
        ...(Array.isArray(props['ACTION_TAGS']) ? (props['ACTION_TAGS'] as string[]) : []),
        ...(Array.isArray(props['actionTags']) ? (props['actionTags'] as string[]) : []),
      ].map((t) => String(t || '').toLowerCase());
      const primary = String(props['ACTION_TAG'] || props['actionTag'] || '').toLowerCase();
      if (primary) tags.push(primary);
      const tagOk = Array.from(this.lastActionTagSet).some((tag) => tags.includes(tag));
      if (!tagOk) return false;
    }

    if (this.favoritesVisible) {
      const key = String(props['PLACE_KEY'] || '');
      if (!key || !this.favoriteKeys.has(key)) return false;
    }

    if (this.searchKeys) {
      const key = String(props['PLACE_KEY'] || '');
      if (!key || !this.searchKeys.has(key)) return false;
    }

    return true;
  }

  private sameKeySet(a: Set<string> | null, b: Set<string> | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.size !== b.size) return false;
    for (const k of a) {
      if (!b.has(k)) return false;
    }
    return true;
  }

  private computePlaceKey(props: any, coords?: [number, number], legacyId?: string | number | null) {
    const addr = this.normAddress(props?.ADDRESS_LINE1 || props?.ADDRESS);
    if (addr) return `addr|${addr}`;
    if (Array.isArray(coords) && coords.length === 2 && isFinite(coords[0]) && isFinite(coords[1])) {
      return `coords|${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`;
    }
    const legacy = props?.LEGACY_ID ?? legacyId;
    if (legacy !== null && legacy !== undefined && legacy !== '') return `id|${String(legacy)}`;
    const name = this.normString(props?.STORE_NAME || props?.NAME);
    if (name && Array.isArray(coords) && coords.length === 2 && isFinite(coords[0]) && isFinite(coords[1])) {
      return `namecoords|${name}|${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`;
    }
    return '';
  }

  private normString(s?: string | null) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g,' ').replace(/[,\.;:]+$/,'');
  }
  private normAddress(addr?: string | null) {
    const s = this.normString(addr);
    const m = s.match(/^(\d+[a-z]?)\s+(.+)$/i);
    return m ? `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ') : s;
  }

  private onFavoritesUpdate = (ev: any) => {
    try {
      const items = ev?.detail?.items || [];
      const keys = new Set<string>();
      items.forEach((i: any) => { if (i?.key) keys.add(String(i.key)); });
      this.setFavoriteKeys(keys);
    } catch {}
  };

  private syncFavoriteKeysFromGlobal() {
    try {
      const getter = (window as any)?.circeco?.favorites?.getFavoriteKeys;
      if (typeof getter !== 'function') return;
      const keys = getter();
      if (!Array.isArray(keys)) return;
      this.favoriteKeys = new Set(keys.map((k: unknown) => String(k)));
    } catch {}
  }

  private applyPaint() {
    if (!this.getLayer('places')) return;
    const favList = Array.from(this.favoriteKeys);
    const actionColorExpr: any = ['case',
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'refuse'], this.actionTagColors['refuse'],
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'reuse'], this.actionTagColors['reuse'],
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'repair'], this.actionTagColors['repair'],
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'repurpose'], this.actionTagColors['repurpose'],
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'recycle'], this.actionTagColors['recycle'],
      ['==', ['downcase', ['coalesce', ['get', 'ACTION_TAG'], ['get', 'actionTag'], '']], 'reduce'], this.actionTagColors['reduce'],
      ['in', 'refuse', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['refuse'],
      ['in', 'reuse', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['reuse'],
      ['in', 'repair', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['repair'],
      ['in', 'repurpose', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['repurpose'],
      ['in', 'recycle', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['recycle'],
      ['in', 'reduce', ['coalesce', ['get', 'ACTION_TAGS'], ['get', 'actionTags'], ['literal', []]]], this.actionTagColors['reduce'],
      this.baseColor
    ];
    const colorExpr = favList.length
      ? ['case',
          ['in', ['get', 'PLACE_KEY'], ['literal', favList]],
          '#FF5252',
          actionColorExpr]
      : actionColorExpr;
    this.map.setPaintProperty('places', 'circle-color', colorExpr);
  }
}
