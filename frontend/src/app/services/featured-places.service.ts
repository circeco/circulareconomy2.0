import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable, of } from 'rxjs';

export interface FeaturedPlace {
  id: string;
  name: string;
  address: string;
  description: string;
  storeType: string;
  label: string;
  coords?: { lng: number; lat: number };
}

@Injectable({ providedIn: 'root' })
export class FeaturedPlacesService {
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
      };
      if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        place.coords = { lng: coords[0], lat: coords[1] };
      }
      return place;
    });
  }

  getFeaturedPlaces(): Observable<FeaturedPlace[]> {
    if (this.cached) return of(this.cached.slice(0, 4));
    return this.getAllPlaces().pipe(
      map((places) => {
        this.cached = places;
        return places.slice(0, 4);
      })
    );
  }

  getAllPlaces(): Observable<FeaturedPlace[]> {
    if (this.cached) return of(this.cached);
    return this.http.get<any>(this.DATA_URL).pipe(
      map((fc) => {
        const features = fc?.features ?? [];
        this.cached = this.parsePlaces(features);
        return this.cached;
      })
    );
  }
}
