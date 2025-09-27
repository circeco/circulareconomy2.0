import { Component, AfterViewInit, OnDestroy, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environments'; // adjust if your env path differs

declare const mapboxgl: any; // provided by CDN in index.html

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private map: any;

  // ---- constants (preserved from legacy) ----
  private readonly STOCKHOLM: [number, number] = [18.072, 59.325];
  private readonly BOUNDS: [[number, number], [number, number]] = [[15.072078, 58.247414],[19.180375, 60.008548]];
  private readonly CATEGORY_IDS = ['apparel','home','cycling-sports','electronics-books-music'];
  private readonly QUERY_LAYER_IDS = ['places','favorites'];
  private enabledCategories = new Set<string>(this.CATEGORY_IDS);

  private readonly CATEGORY_CIRCLE_PAINT: any = {
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
  };

  // ---- enrichment index for favourites ----
  private placesIndexByNameAddr = new Map<string, any>();
  private placesIndexByCoord = new Map<string, any>();
  private placesIndexReady = false;

  // ---- listing state ----
  private allFeatures: any[] = [];
  private rebuildPending = false;

  // ---- heart auto-mount queue (if favorites service late) ----
  private heartMountQueue: Array<{ btn: HTMLButtonElement, place: any }> = [];

  // ---- overlay state (replaces overlay.js) ----
  listOpen = false;

  // ---- window event handlers (so we can remove them) ----
  private onFavUpdate = () => this.rebuildListSoon();
  private onFavAuth = (e: any) => this.setFavLinkDisabled(!e.detail?.user);
  private onFavReady = () => this.flushHeartQueue();

  constructor(private zone: NgZone) {}

  async ngAfterViewInit(): Promise<void> {
    // subscribe to global events (added once)
    window.addEventListener('favorites:update', this.onFavUpdate);
    window.addEventListener('favorites:auth', this.onFavAuth);
    window.addEventListener('favorites-ready', this.onFavReady);

    if (typeof mapboxgl === 'undefined') {
      console.error('[map] mapboxgl global not found (CDN missing).');
      return;
    }

    mapboxgl.accessToken = (environment as any)?.mapboxToken
      || 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

    this.zone.runOutsideAngular(() => {
      this.map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
        center: this.STOCKHOLM,
        zoom: 10,
        maxBounds: this.BOUNDS
      });

      this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

      // ignore blank missing sprite lookups
      this.map.on('styleimagemissing', (e: any) => { if (!e.id) return; });

      // expose map for favourites service
      (window as any).circeco = (window as any).circeco || {};
      (window as any).circeco.map = this.map;
      if (!(window as any).circeco.openAuthModal) (window as any).circeco.openAuthModal = () => {};

      this.map.on('load', () => this.onMapLoad());
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('favorites:update', this.onFavUpdate);
    window.removeEventListener('favorites:auth', this.onFavAuth);
    window.removeEventListener('favorites-ready', this.onFavReady);
    try { this.map?.remove(); } catch {}
    this.map = null;
  }

  // Make the canvas respond to viewport changes
  @HostListener('window:resize')
  onWindowResize() { try { this.map?.resize(); } catch {} }

  // Close list on ESC
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) { if (ev.key === 'Escape' && this.listOpen) this.toggleList(false); }

  // ---- overlay actions (replaces overlay.js) ----
  toggleList(force?: boolean) {
    this.listOpen = typeof force === 'boolean' ? force : !this.listOpen;
    setTimeout(() => this.onWindowResize(), 300); // after CSS transition
  }
  onOverlayBackdrop(_ev: MouseEvent) { this.toggleList(false); }

  // -------------------- Map setup --------------------
  private onMapLoad() {
    const DATA_URL = new URL('assets/data/circular_places.geojson', document.baseURI).toString();

    this.map.addSource('places', { type:'geojson', data: DATA_URL });
    fetch(DATA_URL).then(r=>r.json()).then(fc => { this.buildIndex(fc); this.rebuildListSoon(); }).catch(()=>{});

    this.map.addLayer({
      id: 'places', type:'circle', source:'places',
      layout:{ visibility:'visible' },
      paint: this.CATEGORY_CIRCLE_PAINT,
      filter: this.buildPlacesFilterExpression()
    });

    // favorites source (FavoritesService keeps data in sync)
    this.map.addSource('favorites', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
    this.map.addLayer({
      id: 'favorites', type:'circle', source:'favorites',
      layout:{ visibility:'visible' },
      paint:{ 'circle-radius':5, 'circle-color':'#FF5252' }
    });

    // popup click for both layers
    this.map.on('click', (e: any) => {
      const layers = this.existingQueryLayerIds({ visibleOnly:true });
      if (!layers.length) return;
      const feats = this.map.queryRenderedFeatures(e.point, { layers });
      if (!feats?.length) return;
      const best = feats.find((f: any) => f.layer?.id !== 'favorites') || feats[0];

      const coords = best.geometry?.coordinates ? best.geometry.coordinates.slice() : [e.lngLat.lng, e.lngLat.lat];
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) coords[0] += (e.lngLat.lng > coords[0] ? 360 : -360);

      document.querySelector('.mapboxgl-popup')?.remove();
      new mapboxgl.Popup({ closeOnClick:true })
        .setLngLat(coords)
        .setDOMContent(this.buildPopupContent(best))
        .addTo(this.map);
    });

    // pointer cursor on hover
    this.map.on('mousemove', (e: any) => {
      const layers = this.existingQueryLayerIds({ visibleOnly:true });
      const feats = layers.length ? this.map.queryRenderedFeatures(e.point, { layers }) : [];
      this.map.getCanvas().style.cursor = (feats && feats.length) ? 'pointer' : '';
    });

    // UI hooks
    this.buildLayerToggles();
    this.map.once('idle', () => this.rebuildListNow());
    this.map.on('idle', () => this.rebuildListSoon());
  }

  // -------------------- Hearts auto-mount --------------------
  private mountHeart(btn: HTMLButtonElement, place: any) {
    btn.addEventListener('click', ev => ev.stopPropagation());
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (api) {
      api(btn, place);
      (btn as any).dataset.heartMounted = '1';
    } else {
      this.heartMountQueue.push({ btn, place });
      btn.textContent = '♡';
    }
  }
  private flushHeartQueue() {
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (!api) return;
    while (this.heartMountQueue.length) {
      const { btn, place } = this.heartMountQueue.shift()!;
      if (!(btn as any).dataset.heartMounted) {
        api(btn, place);
        (btn as any).dataset.heartMounted = '1';
      }
    }
  }

  // -------------------- Helpers --------------------
  private normalizeWebHref(raw: string) {
    const s = (raw || '').trim(); if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : ('https://' + s.replace(/^https?:\/\//i,''));
  }
  private existingQueryLayerIds({ visibleOnly=false } = {}) {
    return this.QUERY_LAYER_IDS.filter(id => {
      try {
        if (!this.map.getLayer(id)) return false;
        return !visibleOnly || this.map.getLayoutProperty(id,'visibility') !== 'none';
      } catch { return false; }
    });
  }
  private buildPlacesFilterExpression(): any {
    if (this.enabledCategories.size === 0) return ['==',['literal',1],0];
    const tests: any[] = [];
    this.enabledCategories.forEach(cat => {
      tests.push(['in', cat, ['coalesce',['get','CATEGORIES'], ['literal',[]]]]);
      tests.push(['==', ['get','CATEGORY'], cat]);
    });
    return ['any', ...tests];
  }

  private normString(s: string){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/[,\.;:]+$/,''); }
  private kNA(name: string, addr: string){ const n=this.normString(name), a=this.normString(addr); return n && a ? `${n}|${a}` : ''; }
  private kC(lng: number, lat: number){ return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`; }

  private indexFeature(f: any){
    const p=f.properties||{};
    const name=p.STORE_NAME||p.NAME||'';
    const addr=p.ADDRESS_LINE1||p.ADDRESS||'';
    const c=f.geometry?.coordinates||[];
    const kna=this.kNA(name,addr); if (kna && !this.placesIndexByNameAddr.has(kna)) this.placesIndexByNameAddr.set(kna,f);
    if (c.length===2){ const kc=this.kC(c[0],c[1]); if (!this.placesIndexByCoord.has(kc)) this.placesIndexByCoord.set(kc,f); }
  }
  private buildIndex(fc: any){
    try { (fc.features||[]).forEach((f:any)=>this.indexFeature(f)); this.placesIndexReady=true; }
    catch { this.placesIndexReady=false; }
  }
  private enrichProps(feat: any){
    if (feat?.layer?.id !== 'favorites') return feat.properties || {};
    if (!this.placesIndexReady) return feat.properties || {};
    const p = feat.properties || {};
    const name = p.STORE_NAME || p.NAME || '';
    const addr = p.ADDRESS_LINE1 || p.ADDRESS || '';
    const c = feat.geometry?.coordinates || [];
    const base = (this.kNA(name,addr) && this.placesIndexByNameAddr.get(this.kNA(name,addr)))
              || (c.length===2 && this.placesIndexByCoord.get(this.kC(c[0],c[1])))
              || null;
    if (!base) return p;
    const bp = base.properties || {};
    return {
      ...bp,
      STORE_NAME: p.STORE_NAME || bp.STORE_NAME || bp.NAME || 'Unknown place',
      ADDRESS_LINE1: p.ADDRESS_LINE1 || bp.ADDRESS_LINE1 || bp.ADDRESS || ''
    };
  }
  private buildPlaceForHeart(feat: any){
    const p = this.enrichProps(feat);
    const c = feat.geometry?.coordinates || [0,0];
    const legacyId = String(feat?.id || feat?.properties?.id || `${feat?.layer?.id || 'feat'}:${p.STORE_NAME || p.NAME || 'Unknown'}:${c[0]},${c[1]}`);
    const place: any = {
      name: p.STORE_NAME || p.NAME || 'Unknown place',
      address: p.ADDRESS_LINE1 || p.ADDRESS || '',
      coords: { lng: Number(c[0]), lat: Number(c[1]) },
      legacyId
    };
    const fn = (window as any).circeco?.favorites?.computePlaceKey;
    place.key = fn ? fn(place) : legacyId;
    return place;
  }

  private buildPopupContent(feat: any){
    const props = this.enrichProps(feat);
    const place  = this.buildPlaceForHeart({ ...feat, properties: props });

    const el = document.createElement('div');
    const header = document.createElement('div'); header.className='popup-header';

    const h = document.createElement('h4'); h.style.margin='0';
    h.textContent = props.STORE_NAME || props.NAME || 'Unknown place';

    const btn = document.createElement('button');
    btn.className = 'heart-btn';
    btn.setAttribute('aria-pressed','false');
    this.mountHeart(btn, place);

    header.appendChild(h); header.appendChild(btn); el.appendChild(header);

    if (props.STORE_TYPE) { const t=document.createElement('p'); t.style.margin='4px 0'; t.textContent=props.STORE_TYPE; el.appendChild(t); }
    if (props.ADDRESS_LINE1 || props.ADDRESS) { const a=document.createElement('p'); a.className='address'; a.textContent=props.ADDRESS_LINE1 || props.ADDRESS || ''; el.appendChild(a); }
    const rawWeb=(props.WEB||'').replace(/^https?:\/\//i,''); const href=this.normalizeWebHref(rawWeb);
    if (href){ const a=document.createElement('a'); a.target='_blank'; a.rel='noopener'; a.href=href; a.textContent=rawWeb; el.appendChild(a); }
    if (props.DESCRIPTION){ const d=document.createElement('p'); d.textContent=props.DESCRIPTION; el.appendChild(d); }

    return el;
  }

  // -------------------- Listing (left column) --------------------
  private refreshAllFeatures(){
    try {
      const layerIds = this.existingQueryLayerIds({ visibleOnly:true });
      this.allFeatures = layerIds.length ? (this.map.queryRenderedFeatures({ layers: layerIds }) || []) : [];
    } catch { this.allFeatures = []; }
  }
  private canonicalKey(feature: any){
    try {
      const p = this.enrichProps(feature);
      const name = (p.STORE_NAME || p.NAME || '').trim().toLowerCase();
      const c = feature.geometry?.coordinates || [0,0];
      return `${name}|${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`;
    } catch { return String(feature.id || Math.random()); }
  }
  private dedupe(features: any[]){
    const byKey: Record<string, any> = Object.create(null);
    for (const f of features) {
      const k = this.canonicalKey(f);
      const prev = byKey[k];
      if (!prev) byKey[k] = f;
      else {
        const isFav = f.layer?.id === 'favorites';
        const prevFav = prev.layer?.id === 'favorites';
        if (prevFav && !isFav) byKey[k] = f; // prefer richer non-favourites
      }
    }
    return Object.values(byKey);
  }
  private applyFilter(features: any[]){
    const filterBox = document.getElementById('feature-filter') as HTMLInputElement | null;
    const typed = (filterBox?.value || '').trim().toLowerCase();
    const list = this.dedupe(features);
    if (!typed) return list;
    return list.filter((f: any) => {
      const p = this.enrichProps(f);
      const descr = (p.DESCRIPTION || '').toLowerCase();
      const name  = (p.STORE_NAME || p.NAME || '').toLowerCase();
      const addr  = (p.ADDRESS_LINE1 || p.ADDRESS || '').toLowerCase();
      return descr.includes(typed) || name.includes(typed) || addr.includes(typed);
    });
  }
  private buildLocationList(features: any[]){
    const listings = document.getElementById('listings') as HTMLElement | null;
    if (!listings) return;
    listings.innerHTML = '';

    const sorted = features.slice().sort((a,b) => {
      const ap = this.enrichProps(a), bp = this.enrichProps(b);
      const an = (ap.STORE_NAME || ap.NAME || '').toLowerCase();
      const bn = (bp.STORE_NAME || bp.NAME || '').toLowerCase();
      return an.localeCompare(bn);
    });

    sorted.forEach((feature, i) => {
      const props = this.enrichProps(feature);
      const place = this.buildPlaceForHeart({ ...feature, properties: props });

      const row = listings.appendChild(document.createElement('div'));
      row.id = 'listing-'+i; row.className='item';

      const header = document.createElement('div'); header.className='listing-header';

      const title = document.createElement('div'); title.className='stockholmlist'; title.id='link-'+i;
      title.textContent = props.STORE_NAME || props.NAME || 'Unknown place';

      const heart = document.createElement('button'); heart.className='heart-btn'; heart.setAttribute('aria-pressed','false');
      this.mountHeart(heart, place);

      header.appendChild(title); header.appendChild(heart); row.appendChild(header);

      if (props.ADDRESS_LINE1 || props.ADDRESS) {
        const addr = document.createElement('p'); addr.className='address';
        addr.textContent = props.ADDRESS_LINE1 || props.ADDRESS || '';
        row.appendChild(addr);
      }
      if (props.DESCRIPTION) {
        const desc = document.createElement('p'); desc.textContent = props.DESCRIPTION || '';
        row.appendChild(desc);
      }

      row.addEventListener('click', () => {
        if (!feature.geometry?.coordinates) return;
        this.map.flyTo({ center: feature.geometry.coordinates, zoom: 14 });
        document.querySelector('.mapboxgl-popup')?.remove();
        new mapboxgl.Popup({ closeOnClick:true })
          .setLngLat(feature.geometry.coordinates)
          .setDOMContent(this.buildPopupContent({ ...feature, properties: props }))
          .addTo(this.map);
      });
    });
  }
  private rebuildListNow(){ this.refreshAllFeatures(); this.buildLocationList(this.applyFilter(this.allFeatures)); }
  private rebuildListSoon(){
    if (this.rebuildPending) return;
    this.rebuildPending=true; requestAnimationFrame(()=>{ this.rebuildPending=false; this.rebuildListNow(); });
  }

  // -------------------- Layer toggles --------------------
  private updatePlacesFilter(){
    try { if (this.map.getLayer('places')) this.map.setFilter('places', this.buildPlacesFilterExpression()); } catch{}
    this.rebuildListSoon();
  }
  private setFavLinkDisabled(disabled: boolean){
    const favLink = document.getElementById('favorites-toggle');
    if (!favLink) return;
    if (disabled) {
      favLink.classList.remove('active');
      favLink.setAttribute('aria-disabled','true');
      favLink.setAttribute('data-tip','Sign in to save favourites');
      try { if (this.map.getLayer('favorites') && this.map.getLayoutProperty('favorites','visibility')==='visible') this.map.setLayoutProperty('favorites','visibility','none'); } catch{}
    } else {
      favLink.removeAttribute('aria-disabled');
      favLink.removeAttribute('data-tip');
      try { if (this.map.getLayer('favorites')) { this.map.setLayoutProperty('favorites','visibility','visible'); favLink.classList.add('active'); } } catch{}
    }
    this.rebuildListSoon();
  }
  private buildLayerToggles(){
    const layersNav = document.getElementById('selectlayers');
    if (!layersNav) return;

    // Favourites first
    let favLink = document.getElementById('favorites-toggle') as HTMLAnchorElement | null;
    if (!favLink) {
      favLink = document.createElement('a');
      favLink.href = '#';
      favLink.id = 'favorites-toggle';
      favLink.textContent = 'favourites ♥︎';
      favLink.className = 'active';
      layersNav.appendChild(favLink);

      favLink.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        const disabled = favLink!.getAttribute('aria-disabled') === 'true';
        if (disabled) return (window as any).circeco.openAuthModal();

        const vis = this.map.getLayoutProperty('favorites','visibility');
        if (vis === 'visible') { this.map.setLayoutProperty('favorites','visibility','none'); favLink!.className=''; }
        else { this.map.setLayoutProperty('favorites','visibility','visible'); favLink!.className='active'; }
        this.rebuildListSoon();
      };
    }

    // Category toggles
    this.CATEGORY_IDS.forEach(cat => {
      const link = document.createElement('a');
      link.href='#';
      link.className = this.enabledCategories.has(cat) ? 'active' : '';
      link.textContent = cat;
      link.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.enabledCategories.has(cat)) { this.enabledCategories.delete(cat); link.className=''; }
        else { this.enabledCategories.add(cat); link.className='active'; }
        this.updatePlacesFilter();
      };
      layersNav.appendChild(link);
    });
  }
}

