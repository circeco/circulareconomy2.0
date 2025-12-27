import { Injectable, NgZone } from '@angular/core';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { environment } from '../../environments/environments';

declare const mapboxgl: any;

@Injectable({ providedIn: 'root' })
export class MapService {
  private map: any;
  private loaded = false;                // style rendered at least once
  private placesReady = false;           // geojson source fully loaded

  private ready$ = new ReplaySubject<boolean>(1); // emits when BOTH are true
  private click$ = new Subject<{ feature: any; coords: [number, number] }>();

  private readonly STOCKHOLM: [number, number] = [18.072, 59.325];
  private readonly BOUNDS: [[number, number], [number, number]] = [[15.072078, 58.247414],[19.180375, 60.008548]];

  constructor(private zone: NgZone) {}

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
        zoom: 10,
        maxBounds: this.BOUNDS
      });

      this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      this.map.on('styleimagemissing', (e: any) => { if (!e.id) return; });

      (window as any).circeco = (window as any).circeco || {};
      (window as any).circeco.map = this.map;
      if (!(window as any).circeco.openAuthModal) (window as any).circeco.openAuthModal = () => {};

      this.map.on('load', () => this.onLoad());
    });
  }

  private onLoad() {
    const DATA_URL = new URL('assets/data/circular_places.geojson', document.baseURI).toString();

    try {
      if (!this.getSource('places')) {
        this.map.addSource('places', { type: 'geojson', data: DATA_URL });
      }
      if (!this.getLayer('places')) {
        this.map.addLayer({
          id: 'places', type: 'circle', source: 'places',
          layout: { visibility: 'visible' },
          paint: {
            'circle-radius': 5,
            'circle-color': [
              'match', ['get', 'STORE_TYPE'],
              'reuse',   '#FF5252',
              'recycle', 'rgb(69,129,142)',
              'refuse',  '#FF8C00',
              'rethink', '#9ACD32',
              'remake',  '#008000',
              'repair',  '#008000',
              'rgb(69,129,142)'
            ]
          }
        });
      }

      if (!this.getSource('favorites')) {
        this.map.addSource('favorites', { type: 'geojson', data: { type:'FeatureCollection', features: [] } });
      }
      if (!this.getLayer('favorites')) {
        this.map.addLayer({
          id: 'favorites', type: 'circle', source: 'favorites',
          layout: { visibility: 'visible' },
          paint: { 'circle-radius': 5, 'circle-color': '#FF5252' }
        });
      }
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
    const layers = () => this.existingVisibleLayers(['places','favorites']);

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
    const tests: any[] = [];
    enabled.forEach(cat => {
      tests.push(['in', cat, ['coalesce',['get','CATEGORIES'], ['literal',[]]]]);
      tests.push(['==', ['get','CATEGORY'], cat]);
    });
    const expr = enabled.size ? ['any', ...tests] : ['==',['literal',1],0];
    try {
      if (this.getLayer('places')) {
        this.map.setFilter('places', expr);
      }
    } catch {}
  }

  setFavoritesVisibility(v: boolean) {
    try {
      if (this.getLayer('favorites')) {
        this.map.setLayoutProperty('favorites','visibility', v ? 'visible' : 'none');
      }
    } catch {}
  }

  queryRenderedFeatures$(layers: string[] = ['places','favorites']): Observable<any[]> {
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
        try {
          cancelAnimationFrame(rafId);
          this.map.off('idle', emit);
          this.map.off('moveend', emit);
          this.map.off('zoomend', emit);
          this.map.off('rotateend', emit);
          this.map.off('pitchend', emit);
        } catch {}
      };
    });
  }

  flyTo(center: [number, number], zoom = 14) { try { this.map.flyTo({ center, zoom }); } catch {} }
  openPopup(center: [number, number], content: HTMLElement) {
    try {
      document.querySelector('.mapboxgl-popup')?.remove();
      new mapboxgl.Popup({ closeOnClick: true }).setLngLat(center).setDOMContent(content).addTo(this.map);
    } catch {}
  }

  resize() { try { this.map?.resize(); } catch {} }
  destroy() { try { this.map?.remove(); } catch {} this.map = null; this.loaded = false; this.placesReady = false; }
}
