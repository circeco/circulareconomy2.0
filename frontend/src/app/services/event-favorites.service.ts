import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'circeco_event_favorites';

@Injectable({ providedIn: 'root' })
export class EventFavoritesService {
  private readonly _favoriteIds = signal<Set<string>>(this.loadFromStorage());

  readonly favoriteIds = this._favoriteIds.asReadonly();

  private loadFromStorage(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  private saveToStorage(ids: Set<string>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch {}
  }

  isFavorite(eventId: string): boolean {
    return this._favoriteIds().has(eventId);
  }

  toggle(eventId: string): void {
    const next = new Set(this._favoriteIds());
    if (next.has(eventId)) {
      next.delete(eventId);
    } else {
      next.add(eventId);
    }
    this._favoriteIds.set(next);
    this.saveToStorage(next);
  }
}
