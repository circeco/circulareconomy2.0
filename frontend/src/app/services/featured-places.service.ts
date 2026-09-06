import { inject, Injectable } from '@angular/core';
import { Firestore, collection, limit, query, where } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

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
  /** Optional text shown for the website link. */
  webLabel?: string;
  coords?: { lng: number; lat: number };
}

@Injectable({ providedIn: 'root' })
export class FeaturedPlacesService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);
  private unknownActionTagsLogged = false;

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

  getFeaturedPlaces(): Observable<FeaturedPlace[]> {
    return this.getAllPlaces().pipe(map((places) => places.slice(0, 4)));
  }

  /** Approved catalogue places for the current city only (no static GeoJSON merge). */
  getAllPlaces(): Observable<FeaturedPlace[]> {
    return this.cityContext.cityId$.pipe(switchMap((cityId) => this.getFirestorePlaces(cityId)));
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
              WEB_LABEL: p.webLabel || '',
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
        limit(500)
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
            webLabel: typeof d['websiteLabel'] === 'string' ? d['websiteLabel'].trim() : '',
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
}
