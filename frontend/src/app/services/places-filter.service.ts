import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { canonicalizeActionTag } from '../data/taxonomy';
import { GeolocationService } from './geolocation.service';

export interface PlaceProps {
  STORE_NAME?: string; NAME?: string;
  ADDRESS_LINE1?: string; ADDRESS?: string;
  DESCRIPTION?: string; STORE_TYPE?: string;
  CATEGORY?: string; CATEGORIES?: string[];
  WEB?: string;
  PLACE_KEY?: string;
  LEGACY_ID?: string | number | null;
  distanceKm?: number;
  distanceLabel?: string;
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
  readonly CATEGORY_IDS = ['apparel', 'home-garden', 'cycling-sports', 'electronics', 'books-comics-magazines', 'music'];
  readonly ACTION_TAG_IDS = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'];

  private allFeatures$ = new BehaviorSubject<Feature[]>([]);
  private cityFeatures$ = new BehaviorSubject<Feature[]>([]);
  private filterText$ = new BehaviorSubject<string>('');
  private enabledCats$ = new BehaviorSubject<Set<string>>(new Set(this.CATEGORY_IDS));
  private enabledActionTags$ = new BehaviorSubject<Set<string>>(new Set(this.ACTION_TAG_IDS));
  private userOrigin$ = new BehaviorSubject<{ lat: number; lng: number } | null>(null);
  private sortByDistance$ = new BehaviorSubject<boolean>(false);
  private favoriteKeys$ = new BehaviorSubject<Set<string>>(new Set());
  private favoritesOnly$ = new BehaviorSubject<boolean>(false);

  private placesIndexByNameAddr = new Map<string, Feature>();
  private placesIndexByCoord = new Map<string, Feature>();
  private placesIndexReady = false;

  constructor(private geo: GeolocationService) {}

  setAllFeatures(list: Feature[]) { this.allFeatures$.next(list ?? []); }
  setCityFeatures(fc: FeatureCollection | { features?: Feature[] } | null) {
    const features = (fc?.features || []) as Feature[];
    this.cityFeatures$.next(features);
    this.buildIndex({ type: 'FeatureCollection', features });
  }
  setFilter(text: string) { this.filterText$.next((text || '').trim().toLowerCase()); }
  setUserOrigin(origin: { lat: number; lng: number } | null) { this.userOrigin$.next(origin); }
  setSortByDistance(on: boolean) { this.sortByDistance$.next(!!on); }
  setFavoriteKeys(keys: Set<string>) { this.favoriteKeys$.next(new Set(keys)); }
  setFavoritesOnly(on: boolean) { this.favoritesOnly$.next(!!on); }
  toggleCategory(cat: string) {
    const next = new Set(this.enabledCats$.value);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    this.enabledCats$.next(next);
  }
  setCategories(set: Set<string>) { this.enabledCats$.next(new Set(set)); }
  setActionTags(set: Set<string>) { this.enabledActionTags$.next(new Set(set)); }

  buildIndex(fc: FeatureCollection) {
    this.placesIndexByNameAddr.clear();
    this.placesIndexByCoord.clear();
    try { (fc.features||[]).forEach(f => this.indexFeature(f)); this.placesIndexReady = true; }
    catch { this.placesIndexReady = false; }
  }

  readonly enabledCategories$ = this.enabledCats$.asObservable();
  readonly enabledActionTagsState$ = this.enabledActionTags$.asObservable();
  readonly filteredFeatures$ = combineLatest([
    this.allFeatures$,
    this.cityFeatures$,
    this.filterText$,
    this.enabledCats$,
    this.enabledActionTags$,
    this.userOrigin$,
    this.sortByDistance$,
  ]).pipe(
    map(([visible, city, typed, enabledCats, enabledTags, origin, sortByDistance]) => {
      const nearby = !!sortByDistance && !!origin;
      // Full city catalogue while searching so DESCRIPTION (and other fields) are available
      // even when the list UI hides them and Mapbox rendered features omit them.
      let list = typed && city.length ? this.dedupe(city) : this.dedupe(visible);
      if (typed && city.length) {
        list = list.filter((f: Feature) => this.matchesCategories(f, enabledCats));
      }
      list = list.filter((f: Feature) => this.matchesActionTags(f, enabledTags));
      if (typed) {
        list = list.filter((f: Feature) => this.matchesSearchText(f, typed));
      }
      if (nearby && origin) {
        list = list
          .map((f) => this.withDistance(f, origin))
          .sort((a, b) => (a.properties.distanceKm ?? Infinity) - (b.properties.distanceKm ?? Infinity));
      }
      return list;
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
    const p = feat.properties || {};
    if (!this.placesIndexReady) return p;
    const name = p.STORE_NAME || p.NAME || '';
    const addr = p.ADDRESS_LINE1 || p.ADDRESS || '';
    const c = feat.geometry?.coordinates || [];
    const base = (this.kNA(name,addr) && this.placesIndexByNameAddr.get(this.kNA(name,addr)))
              || (c.length===2 && this.placesIndexByCoord.get(this.kC(c[0],c[1])))
              || null;
    if (!base) return p;
    const bp = base.properties || {};
    if (feat?.layer?.id === 'favorites') {
      return {
        ...bp,
        STORE_NAME: p.STORE_NAME || bp.STORE_NAME || bp.NAME || 'Unknown place',
        ADDRESS_LINE1: p.ADDRESS_LINE1 || bp.ADDRESS_LINE1 || bp.ADDRESS || ''
      };
    }
    return {
      ...bp,
      ...p,
      DESCRIPTION: p.DESCRIPTION || (p as any).description || bp.DESCRIPTION || '',
      STORE_NAME: p.STORE_NAME || p.NAME || bp.STORE_NAME || bp.NAME,
      ADDRESS_LINE1: p.ADDRESS_LINE1 || p.ADDRESS || bp.ADDRESS_LINE1 || bp.ADDRESS || '',
    };
  }

  private matchesSearchText(feature: Feature, typed: string): boolean {
    const p = this.enrichProps(feature) as PlaceProps & { description?: string };
    const hay = [
      p.DESCRIPTION,
      p.description,
      p.STORE_NAME,
      p.NAME,
      p.ADDRESS_LINE1,
      p.ADDRESS,
    ]
      .map((s) => String(s || '').toLowerCase())
      .join('\n');
    return hay.includes(typed);
  }

  private matchesCategories(feature: Feature, enabled: Set<string>): boolean {
    // Empty set means "all categories" (same convention as the map filter).
    if (!enabled.size || enabled.size >= this.CATEGORY_IDS.length) return true;
    const props = this.enrichProps(feature) as PlaceProps & { CATEGORIES?: unknown[] };
    const primary = String(props.CATEGORY || '').toLowerCase();
    if (primary && enabled.has(primary)) return true;
    const cats = Array.isArray(props.CATEGORIES) ? props.CATEGORIES : [];
    for (const c of cats) {
      if (enabled.has(String(c || '').toLowerCase())) return true;
    }
    return false;
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

  private withDistance(feature: Feature, origin: { lat: number; lng: number }): Feature {
    const coords = feature.geometry?.coordinates || [];
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const props = { ...(this.enrichProps(feature) || {}) };
    if (isFinite(lng) && isFinite(lat)) {
      const km = this.geo.haversineKm(origin, { lat, lng });
      props.distanceKm = km;
      props.distanceLabel = this.geo.formatDistance(km);
    }
    return { ...feature, properties: props };
  }

  private matchesActionTags(feature: Feature, enabledTags: Set<string>) {
    if (!enabledTags.size) return false;
    if (enabledTags.size === this.ACTION_TAG_IDS.length) return true;
    const props = this.enrichProps(feature) as any;
    const rawTagsUpper = Array.isArray(props?.ACTION_TAGS) ? props.ACTION_TAGS : [];
    const rawTagsLower = Array.isArray(props?.actionTags) ? props.actionTags : [];
    const tagSet = new Set<string>(
      [...rawTagsUpper, ...rawTagsLower]
        .map((t: unknown) => canonicalizeActionTag(String(t || '').trim().toLowerCase()) || String(t || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const primaryRaw = String(props?.ACTION_TAG || props?.actionTag || '').toLowerCase();
    const primary = canonicalizeActionTag(primaryRaw) || primaryRaw;
    if (primary) tagSet.add(primary);
    for (const t of enabledTags) {
      if (tagSet.has(String(t).toLowerCase())) return true;
    }
    return false;
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
