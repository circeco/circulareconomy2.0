import { Injectable, NgZone } from '@angular/core';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { environment } from '../../environments/environments';
import { ACTION_TAG_COLORS, ACTION_TAGS } from '../data/taxonomy';

declare const mapboxgl: any;

@Injectable({ providedIn: 'root' })
export class MapService {
  private map: any;
  private loaded = false;                // style rendered at least once
  private placesReady = false;           // geojson source fully loaded

  private favoriteKeys = new Set<string>();
  private favoritesVisible = true;
  private lastCategorySet = new Set<string>();
  private readonly allActionTags = ACTION_TAGS.slice();
  private lastActionTagSet = new Set<string>(this.allActionTags);
  private readonly baseColor = 'rgb(69,129,142)';
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;

  private ready$ = new ReplaySubject<boolean>(1); // emits when BOTH are true
  private click$ = new Subject<{ feature: any; coords: [number, number] }>();

  private readonly STOCKHOLM: [number, number] = [18.072, 59.325];
  private readonly EMPTY_FC: { type: 'FeatureCollection'; features: any[] } = {
    type: 'FeatureCollection',
    features: [],
  };
  private pendingPlacesData: { type: 'FeatureCollection'; features: any[] } = this.EMPTY_FC;
  private pendingCityCenter: [number, number] | null = null;

  constructor(private zone: NgZone) { }

  onReady(): Observable<boolean> { return this.ready$.asObservable(); }
  onFeatureClick(): Observable<{ feature: any; coords: [number, number] }> { return this.click$.asObservable(); }

  init(container: HTMLElement) {
    if (typeof mapboxgl === 'undefined') {
      console.error('[map] mapboxgl global not found (CDN missing).');
      return;
    }
    mapboxgl.accessToken = (environment as any)?.mapboxToken
      || 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

    this.zone.runOutsideAngular(() => {
      this.map = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
        center: this.STOCKHOLM,
        zoom: 10
      });

      this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
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
      if (!this.getSource('places')) {
        this.map.addSource('places', { type: 'geojson', data: this.EMPTY_FC });
      }
      if (!this.getLayer('places')) {
        this.map.addLayer({
          id: 'places', type: 'circle', source: 'places',
          layout: { visibility: 'visible' },
          paint: {
            'circle-radius': 5,
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
          paint: { 'circle-radius': 5, 'circle-color': '#FF5252' }
        });
      }
      // Apply latest queued places once source exists.
      this.setPlacesData(this.pendingPlacesData);
      if (this.pendingCityCenter) {
        this.map.flyTo({ center: this.pendingCityCenter, zoom: 11 });
      }
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

    this.map.on('click', (e: any) => {
      const ids = layers();
      if (!ids.length) return;

      const feats = this.map.queryRenderedFeatures(e.point, { layers: ids }) || [];
      if (!feats.length) return;

      // prefer non-favorites if both overlap
      const best = feats.find((f: any) => f.layer?.id !== 'favorites') || feats[0];

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
      const feats = ids.length ? this.map.queryRenderedFeatures(e.point, { layers: ids }) : [];
      this.map.getCanvas().style.cursor = (feats && feats.length) ? 'pointer' : '';
    });
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
  }

  setActionTagFilter(enabled: Set<string>) {
    this.lastActionTagSet = new Set(enabled);
    this.applyFilters();
  }

  setFavoritesVisibility(v: boolean) {
    this.favoritesVisible = v;
    if (this.getLayer('favorites')) {
      this.map.setLayoutProperty('favorites', 'visibility', 'none');
    }
    this.applyFilters();
    this.applyPaint();
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

  flyTo(center: [number, number], zoom = 14) {
    if (!this.map?.flyTo) return;
    this.map.flyTo({ center, zoom });
  }

  flyToCity(center: [number, number], zoom = 11) {
    this.pendingCityCenter = center;
    if (!this.map?.flyTo) return;
    this.map.flyTo({ center, zoom });
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
  }

  openPopup(center: [number, number], content: HTMLElement) {
    document.querySelector('.mapboxgl-popup')?.remove();
    new mapboxgl.Popup({ closeOnClick: true }).setLngLat(center).setDOMContent(content).addTo(this.map);
  }

  resize() { this.map?.resize(); }
  destroy() {
    window.removeEventListener('favorites:update', this.onFavoritesUpdate);
    this.map?.remove(); this.map = null; this.loaded = false; this.placesReady = false;
    this.pendingPlacesData = this.EMPTY_FC;
    this.pendingCityCenter = null;
  }

  setFavoriteKeys(keys: Set<string>) {
    this.favoriteKeys = new Set(keys);
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
    if (!this.lastCategorySet.size) {
      if (this.favoritesVisible && favList.length) {
        expr = ['in', ['get', 'PLACE_KEY'], ['literal', favList]];
      } else if (!this.favoritesVisible) {
        expr = ['==', ['literal', 1], 0];
      } else if (this.favoritesVisible && favList.length === 0) {
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

    if (this.getLayer('places')) {
      this.map.setFilter('places', expr);
    }
    this.applyPaint();
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
    const colorExpr = (this.favoritesVisible && favList.length)
      ? ['case',
          ['in', ['get', 'PLACE_KEY'], ['literal', favList]],
          '#FF5252',
          actionColorExpr]
      : actionColorExpr;
    this.map.setPaintProperty('places', 'circle-color', colorExpr);
  }
}
