import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, collection, limit, query, where } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { catchError, combineLatest, map, Observable, of, switchMap } from 'rxjs';

import { FS_PATHS } from '../data/firestore-paths';
import { CityContextService } from './city-context.service';
import {
  canonicalizeActionTag,
  canonicalizeSectorCategories,
} from '../data/taxonomy';

export interface FeaturedPlace {
  id: string;
  name: string;
  address: string;
  description: string;
  storeType: string;
  label: string;
  category?: string;
  categories?: string[];
  actionTags?: string[];
  web?: string;
  coords?: { lng: number; lat: number };
}

@Injectable({ providedIn: 'root' })
export class FeaturedPlacesService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);
  private readonly DATA_URL = 'assets/data/circular_places.geojson';
  private cached: FeaturedPlace[] | null = null;
  private unknownActionTagsLogged = false;

  constructor(private http: HttpClient) {}

  private readonly ATLAS_ACTION_TAGS = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'] as const;

  private toAtlasCategories(raw: unknown): string[] {
    return canonicalizeSectorCategories(Array.isArray(raw) ? (raw as string[]) : []);
  }

  private primaryAtlasCategory(atlasCategories: string[]): string {
    if (atlasCategories.length) return atlasCategories[0];
    return 'home-garden';
  }

  private toAtlasActionTag(raw: unknown): string | null {
    const canonical = canonicalizeActionTag(String(raw ?? ''));
    if (!canonical) return null;
    if ((this.ATLAS_ACTION_TAGS as readonly string[]).includes(canonical)) return canonical;
    return null;
  }

  private deriveActionTagsFromText(raw: unknown): string[] {
    const text = String(raw ?? '').toLowerCase();
    if (!text) return [];
    const out = new Set<string>();
    if (text.includes('refuse')) out.add('refuse');
    if (text.includes('reuse') || text.includes('share') || text.includes('rental')) out.add('reuse');
    if (text.includes('repair') || text.includes('refurbish')) out.add('repair');
    if (text.includes('repurpose') || text.includes('reporpouse') || text.includes('remanufacture')) out.add('repurpose');
    if (text.includes('recycle')) out.add('recycle');
    if (text.includes('reduce')) out.add('reduce');
    return Array.from(out);
  }

  private normalizeActionTags(rawTags: unknown, contextForFallback: unknown[] = [], logContext?: string): string[] {
    const out = new Set<string>();
    const unknown: string[] = [];
    const tags = Array.isArray(rawTags) ? rawTags : [];

    for (const t of tags) {
      const mapped = this.toAtlasActionTag(t);
      if (mapped) out.add(mapped);
      else if (String(t ?? '').trim()) unknown.push(String(t));
    }

    if (!out.size) {
      for (const ctx of contextForFallback) {
        this.deriveActionTagsFromText(ctx).forEach((t) => out.add(t));
      }
    }

    if (unknown.length && !this.unknownActionTagsLogged) {
      this.unknownActionTagsLogged = true;
      console.warn('[atlas] Unknown action tags found; review taxonomy mapping.', { sample: unknown, context: logContext || 'n/a' });
    }

    if (!out.size) {
      console.warn('[atlas] Missing action tags for place; defaulting to reuse. Review source data.', { context: logContext || 'n/a' });
      out.add('reuse');
    }

    return Array.from(out);
  }

  private parsePlaces(features: unknown[]): FeaturedPlace[] {
    return features.map((f: unknown) => {
      const feat = f as { id?: string; properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } };
      const p = (feat.properties ?? {}) as Record<string, unknown>;
      const coords = feat.geometry?.coordinates;
      const rawCategories = Array.isArray(p['CATEGORIES']) ? (p['CATEGORIES'] as string[]) : [];
      const normalizedCategories = canonicalizeSectorCategories([
        ...rawCategories,
        String(p['CATEGORY'] ?? ''),
      ]);
      const actionTags = this.normalizeActionTags(
        p['ACTION_TAGS'] ?? p['actionTags'] ?? [],
        [p['STORE_TYPE'], p['CATEGORY'], ...(Array.isArray(p['CATEGORIES']) ? p['CATEGORIES'] : [])],
        String(feat.id ?? p['STORE_NAME'] ?? p['NAME'] ?? '')
      );
      const place: FeaturedPlace = {
        id: String(feat.id ?? p['id'] ?? ''),
        name: String(p['STORE_NAME'] ?? p['NAME'] ?? 'Unknown'),
        address: String(p['ADDRESS_LINE1'] ?? p['ADDRESS'] ?? ''),
        description: String(p['DESCRIPTION'] ?? ''),
        storeType: String(p['STORE_TYPE'] ?? ''),
        label: String(p['LABEL'] ?? ''),
        category: normalizedCategories[0] || this.primaryAtlasCategory(this.toAtlasCategories(rawCategories)),
        categories: normalizedCategories.length ? normalizedCategories : this.toAtlasCategories(rawCategories),
        actionTags,
        web: String(p['WEB'] ?? ''),
      };
      if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        place.coords = { lng: coords[0], lat: coords[1] };
      }
      return place;
    });
  }

  getFeaturedPlaces(): Observable<FeaturedPlace[]> {
    return this.getAllPlaces().pipe(map((places) => places.slice(0, 4)));
  }

  getAllPlaces(): Observable<FeaturedPlace[]> {
    return this.cityContext.cityId$.pipe(
      switchMap((cityId) =>
        combineLatest([this.getFirestorePlaces(cityId), this.getStockholmStatic(cityId)]).pipe(
          map(([remote, fallback]) => this.mergePlaces(remote, fallback))
        )
      )
    );
  }

  getGeoJsonForCurrentCity(): Observable<{ type: 'FeatureCollection'; features: any[] }> {
    return this.getAllPlaces().pipe(
      map((places) => ({
        type: 'FeatureCollection' as const,
        features: places
          .filter((p) => p.coords && isFinite(p.coords.lng) && isFinite(p.coords.lat))
          .map((p) => ({
            type: 'Feature',
            id: p.id,
            geometry: { type: 'Point', coordinates: [p.coords!.lng, p.coords!.lat] },
            properties: {
              STORE_NAME: p.name,
              ADDRESS_LINE1: p.address,
              DESCRIPTION: p.description,
              STORE_TYPE: p.storeType || p.category || 'reuse',
              CATEGORY: p.category || p.storeType || 'reuse',
              CATEGORIES: p.categories?.length ? p.categories : (p.label ? [p.label] : []),
              ACTION_TAGS: p.actionTags?.length ? p.actionTags : [],
              ACTION_TAG: p.actionTags?.[0] || '',
              WEB: p.web || '',
            },
          })),
      }))
    );
  }

  private getFirestorePlaces(cityId: string): Observable<FeaturedPlace[]> {
    return collectionData(
      query(
        collection(this.fs, FS_PATHS.places),
        where('status', '==', 'approved'),
        where('cityId', '==', cityId),
        limit(200)
      ),
      { idField: 'id' }
    ).pipe(
      map((docs: Record<string, unknown>[]) =>
        docs.map((d) => {
          const c = d['coords'] as { lat?: unknown; lng?: unknown } | undefined;
          const lat = typeof c?.lat === 'number' ? c.lat : undefined;
          const lng = typeof c?.lng === 'number' ? c.lng : undefined;
          const atlasCategories = this.toAtlasCategories(d['sectorCategories']);
          const actionTags = this.normalizeActionTags(
            d['actionTags'],
            [d['storeType'], d['description']],
            String(d['id'] ?? d['name'] ?? '')
          );
          return {
            id: String(d['id'] ?? ''),
            name: String(d['name'] ?? 'Unknown'),
            address: String(d['address'] ?? ''),
            description: String(d['description'] ?? ''),
            storeType: String((d['actionTags'] as string[] | undefined)?.[0] ?? 'reuse'),
            label: String((d['actionTags'] as string[] | undefined)?.[0] ?? ''),
            category: this.primaryAtlasCategory(atlasCategories),
            categories: atlasCategories,
            actionTags,
            web: typeof d['website'] === 'string' ? d['website'] : '',
            coords:
              lat != null && lng != null && isFinite(lat) && isFinite(lng)
                ? { lat, lng }
                : undefined,
          } as FeaturedPlace;
        })
      ),
      catchError(() => of([]))
    );
  }

  private getStockholmStatic(cityId: string): Observable<FeaturedPlace[]> {
    if (cityId !== 'stockholm') return of([]);
    if (this.cached) return of(this.cached);
    return this.http.get<any>(this.DATA_URL).pipe(
      map((fc) => {
        const features = fc?.features ?? [];
        this.cached = this.parsePlaces(features);
        return this.cached;
      })
    );
  }

  private mergePlaces(remote: FeaturedPlace[], fallback: FeaturedPlace[]): FeaturedPlace[] {
    const byKey = new Map<string, FeaturedPlace>();
    for (const p of [...remote, ...fallback]) {
      const key = `${p.name.toLowerCase().trim()}|${this.canonicalAddressKey(p.address)}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, p);
      } else {
        byKey.set(key, this.mergePlaceRecords(prev, p));
      }
    }
    return Array.from(byKey.values());
  }

  private mergePlaceRecords(base: FeaturedPlace, incoming: FeaturedPlace): FeaturedPlace {
    const mergedCategories = canonicalizeSectorCategories([
      ...(base.categories || []),
      base.category || '',
      ...(incoming.categories || []),
      incoming.category || '',
    ]);

    const mergedActionTags = Array.from(
      new Set(
        [...(base.actionTags || []), ...(incoming.actionTags || [])]
          .map((tag) => canonicalizeActionTag(String(tag || '')) || String(tag || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    const baseCoordsOk =
      !!base.coords && isFinite(base.coords.lat) && isFinite(base.coords.lng);
    const incomingCoordsOk =
      !!incoming.coords && isFinite(incoming.coords.lat) && isFinite(incoming.coords.lng);

    return {
      ...base,
      id: base.id || incoming.id,
      name: base.name || incoming.name,
      address: base.address || incoming.address,
      description: base.description || incoming.description,
      storeType: base.storeType || incoming.storeType,
      label: base.label || incoming.label,
      web: base.web || incoming.web,
      actionTags: mergedActionTags.length ? mergedActionTags : (base.actionTags || incoming.actionTags || []),
      categories: mergedCategories.length ? mergedCategories : (base.categories || incoming.categories),
      category:
        mergedCategories[0] ||
        base.category ||
        incoming.category ||
        this.primaryAtlasCategory([]),
      coords: baseCoordsOk
        ? base.coords
        : (incomingCoordsOk ? incoming.coords : base.coords || incoming.coords),
    };
  }

  private canonicalAddressKey(v: string): string {
    const raw = String(v || '').toLowerCase().replace(/[.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d+[a-z]?)\s+(.+)$/i);
    return m ? `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ') : raw;
  }
}
