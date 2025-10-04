import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

export interface PlaceProps {
  STORE_NAME?: string; NAME?: string;
  ADDRESS_LINE1?: string; ADDRESS?: string;
  DESCRIPTION?: string; STORE_TYPE?: string;
  CATEGORY?: string; CATEGORIES?: string[];
  WEB?: string;
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
  private normString(s: string){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/[,\.;:]+$/,''); }
  private kNA(name: string, addr: string){ const n=this.normString(name), a=this.normString(addr); return n && a ? `${n}|${a}` : ''; }
  private kC(lng: number, lat: number){ return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`; }

  private indexFeature(f: Feature){
    const p=f.properties||{};
    const name=p.STORE_NAME||p.NAME||'';
    const addr=p.ADDRESS_LINE1||p.ADDRESS||'';
    const c=f.geometry?.coordinates||[];
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
      const p = this.enrichProps(feature);
      const name = (p.STORE_NAME || p.NAME || '').trim().toLowerCase();
      const c = feature.geometry?.coordinates || [0,0];
      return `${name}|${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`;
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
}
