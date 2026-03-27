import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, collection, limit, query, where } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { catchError, combineLatest, map, Observable, of, switchMap } from 'rxjs';

import { FS_PATHS } from '../data/firestore-paths';
import { CityContextService } from './city-context.service';

export interface FeaturedPlace {
  id: string;
  name: string;
  address: string;
  description: string;
  storeType: string;
  label: string;
  category?: string;
  categories?: string[];
  web?: string;
  coords?: { lng: number; lat: number };
}

@Injectable({ providedIn: 'root' })
export class FeaturedPlacesService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);
  private readonly DATA_URL = 'assets/data/circular_places.geojson';
  private cached: FeaturedPlace[] | null = null;

  constructor(private http: HttpClient) {}

  private parsePlaces(features: unknown[]): FeaturedPlace[] {
    return features.map((f: unknown) => {
      const feat = f as { id?: string; properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } };
      const p = (feat.properties ?? {}) as Record<string, unknown>;
      const coords = feat.geometry?.coordinates;
      const place: FeaturedPlace = {
        id: String(feat.id ?? p['id'] ?? ''),
        name: String(p['STORE_NAME'] ?? p['NAME'] ?? 'Unknown'),
        address: String(p['ADDRESS_LINE1'] ?? p['ADDRESS'] ?? ''),
        description: String(p['DESCRIPTION'] ?? ''),
        storeType: String(p['STORE_TYPE'] ?? ''),
        label: String(p['LABEL'] ?? ''),
        category: String(p['CATEGORY'] ?? ''),
        categories: Array.isArray(p['CATEGORIES']) ? (p['CATEGORIES'] as string[]) : [],
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
          return {
            id: String(d['id'] ?? ''),
            name: String(d['name'] ?? 'Unknown'),
            address: String(d['address'] ?? ''),
            description: String(d['description'] ?? ''),
            storeType: String((d['actionTags'] as string[] | undefined)?.[0] ?? 'reuse'),
            label: String((d['sectorCategories'] as string[] | undefined)?.[0] ?? ''),
            category: String((d['actionTags'] as string[] | undefined)?.[0] ?? 'reuse'),
            categories: Array.isArray(d['sectorCategories']) ? (d['sectorCategories'] as string[]) : [],
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
      const key = `${p.name.toLowerCase().trim()}|${p.address.toLowerCase().trim()}`;
      if (!byKey.has(key)) byKey.set(key, p);
    }
    return Array.from(byKey.values());
  }
}
