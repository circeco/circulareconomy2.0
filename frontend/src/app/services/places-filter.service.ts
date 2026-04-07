import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

export interface PlaceProps {
  STORE_NAME?: string; NAME?: string;
  ADDRESS_LINE1?: string; ADDRESS?: string;
  DESCRIPTION?: string; STORE_TYPE?: string;
  CATEGORY?: string; CATEGORIES?: string[];
  WEB?: string;
  PLACE_KEY?: string;
  LEGACY_ID?: string | number | null;
}
export interface Feature {
  type: 'Feature';
  geometry: { type: string; coordinates: [number, number] };
  properties: PlaceProps;
  layer?: { id: string };
  id?: string;
}
export interface FeatureCollection { type:'FeatureCollection'; features: Feature[]; }

@Injectable({ providedIn: 'root' })
export class PlacesFilter {
  readonly CATEGORY_IDS = ['apparel','home','cycling-sports','electronics-books-music'];

  private allFeatures$ = new BehaviorSubject<Feature[]>([]);
  private filterText$ = new BehaviorSubject<string>('');
  private enabledCats$ = new BehaviorSubject<Set<string>>(new Set(this.CATEGORY_IDS));

  private placesIndexByNameAddr = new Map<string, Feature>();
  private placesIndexByCoord = new Map<string, Feature>();
  private placesIndexReady = false;

  setAllFeatures(list: Feature[]) { this.allFeatures$.next(list ?? []); }
  setFilter(text: string) { this.filterText$.next((text || '').trim().toLowerCase()); }
  toggleCategory(cat: string) {
    const next = new Set(this.enabledCats$.value);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    this.enabledCats$.next(next);
  }
  setCategories(set: Set<string>) { this.enabledCats$.next(new Set(set)); }

  buildIndex(fc: FeatureCollection) {
    try { (fc.features||[]).forEach(f => this.indexFeature(f)); this.placesIndexReady = true; }
    catch { this.placesIndexReady = false; }
  }

  readonly enabledCategories$ = this.enabledCats$.asObservable();
  readonly filteredFeatures$ = combineLatest([this.allFeatures$, this.filterText$]).pipe(
    map(([all, typed]) => {
      const list = this.dedupe(all);
      if (!typed) return list;
      return list.filter((f: Feature) => {
        const p = this.enrichProps(f);
        const descr = (p.DESCRIPTION || '').toLowerCase();
        const name  = (p.STORE_NAME || p.NAME || '').toLowerCase();
        const addr  = (p.ADDRESS_LINE1 || p.ADDRESS || '').toLowerCase();
        return descr.includes(typed) || name.includes(typed) || addr.includes(typed);
      });
    })
  );

  enrichForUI(feat: Feature) { return this.enrichProps(feat); }

  // ---- helpers (ported) ----
  private normString(s?: string | null){
    return String(s || '').trim().toLowerCase().replace(/\s+/g,' ').replace(/[,\.;:]+$/,'');
  }
  private normAddress(addr?: string | null){
    const s = this.normString(addr);
    const m = s.match(/^(\d+[a-z]?)\s+(.+)$/i);
    return m ? `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ') : s;
  }
  private kNA(name: string, addr: string){ const n=this.normString(name), a=this.normAddress(addr); return n && a ? `${n}|${a}` : ''; }
  private kC(lng: number, lat: number){ return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`; }

  private indexFeature(f: Feature){
    const p=f.properties||{};
    const coords = f.geometry?.coordinates || [];
    const key = this.computePlaceKey(p, coords as [number, number], f.id);
    if (key && !p.PLACE_KEY) (p as any).PLACE_KEY = key;
    const name=p.STORE_NAME||p.NAME||'';
    const addr=p.ADDRESS_LINE1||p.ADDRESS||'';
    const c=coords||[];
    const kna=this.kNA(name,addr); if (kna && !this.placesIndexByNameAddr.has(kna)) this.placesIndexByNameAddr.set(kna,f);
    if (c.length===2){ const kc=this.kC(c[0],c[1]); if (!this.placesIndexByCoord.has(kc)) this.placesIndexByCoord.set(kc,f); }
  }

  private enrichProps(feat: Feature){
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

  private canonicalKey(feature: Feature){
    try {
      const props = this.enrichProps(feature) || {};
      if (props.PLACE_KEY) return String(props.PLACE_KEY);
      const coords = feature.geometry?.coordinates || [0,0];
      const key = this.computePlaceKey(props, coords as [number, number], (feature as any)?.id);
      if (key) {
        (feature.properties as any).PLACE_KEY = key;
        return key;
      }
      const fallback = `${this.normString(props.STORE_NAME || props.NAME)}|${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`;
      (feature.properties as any).PLACE_KEY = fallback;
      return fallback;
    } catch { return String(feature.id || Math.random()); }
  }

  private dedupe(features: Feature[]){
    const byKey: Record<string, Feature> = Object.create(null);
    for (const f of features) {
      const k = this.canonicalKey(f);
      const prev = byKey[k];
      if (!prev) byKey[k] = f;
      else {
        const isFav = f.layer?.id === 'favorites';
        const prevFav = prev.layer?.id === 'favorites';
        if (prevFav && !isFav) byKey[k] = f;
      }
    }
    return Object.values(byKey);
  }

  private computePlaceKey(props: PlaceProps, coords?: [number, number], legacyId?: string | number | null) {
    const addrKey = this.normAddress(props.ADDRESS_LINE1 || props.ADDRESS);
    if (addrKey) return `addr|${addrKey}`;
    if (Array.isArray(coords) && coords.length === 2 && isFinite(coords[0]) && isFinite(coords[1])) {
      return `coords|${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`;
    }
    const legacy = props.LEGACY_ID ?? legacyId;
    if (legacy !== null && legacy !== undefined && legacy !== '') return `id|${String(legacy)}`;
    const nameKey = this.normString(props.STORE_NAME || props.NAME);
    if (nameKey && Array.isArray(coords) && coords.length === 2 && isFinite(coords[0]) && isFinite(coords[1])) {
      return `namecoords|${nameKey}|${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`;
    }
    return '';
  }
}
