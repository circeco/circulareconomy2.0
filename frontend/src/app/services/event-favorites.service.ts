import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  deleteDoc,
} from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { Observable, Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { FS_PATHS } from '../data/firestore-paths';

const LEGACY_STORAGE_KEY = 'circeco_event_favorites';

@Injectable({ providedIn: 'root' })
export class EventFavoritesService {
  private fs = inject(Firestore);
  private authSvc = inject(AuthService);

  private readonly _favoriteIds = signal<Set<string>>(new Set());
  readonly favoriteIds = this._favoriteIds.asReadonly();

  private uid: string | null = null;
  private favSub?: Subscription;

  constructor() {
    this.clearLegacySharedStorage();

    this.authSvc.user$.subscribe((user) => {
      this.uid = user?.uid ?? null;
      this._favoriteIds.set(new Set());
      this.favSub?.unsubscribe();
      this.favSub = undefined;

      if (!user) return;

      this.favSub = this.listen(user.uid).subscribe({
        next: (docs) => {
          const ids = new Set<string>();
          for (const d of docs) {
            const id = String(d?.id || d?.eventId || '');
            if (id) ids.add(id);
          }
          this._favoriteIds.set(ids);
        },
        error: (err) => {
          console.error('[event-favourites] snapshot error', err);
          this._favoriteIds.set(new Set());
        },
      });
    });
  }

  isFavorite(eventId: string): boolean {
    return this._favoriteIds().has(eventId);
  }

  async toggle(eventId: string): Promise<void> {
    const uid = this.uid;
    if (!uid || !isSafeEventId(eventId)) return;

    if (this._favoriteIds().has(eventId)) {
      await this.removeFavorite(uid, eventId, { optimistic: true });
    } else {
      await this.addFavorite(uid, eventId, { optimistic: true });
    }
  }

  protected listen(uid: string): Observable<{ id?: string; eventId?: string }[]> {
    return collectionData(
      collection(this.fs, FS_PATHS.userEventFavourites(uid)),
      { idField: 'id' }
    ) as Observable<{ id?: string; eventId?: string }[]>;
  }

  protected writeFavorite(uid: string, eventId: string): Promise<void> {
    return setDoc(
      doc(this.fs, `${FS_PATHS.userEventFavourites(uid)}/${eventId}`),
      {
        eventId,
        serverCreatedAt: serverTimestamp(),
        clientCreatedAt: new Date(),
      },
      { merge: true }
    );
  }

  protected deleteFavorite(uid: string, eventId: string): Promise<void> {
    return deleteDoc(doc(this.fs, `${FS_PATHS.userEventFavourites(uid)}/${eventId}`));
  }

  private async addFavorite(
    uid: string,
    eventId: string,
    opts: { optimistic: boolean }
  ): Promise<void> {
    const prev = this._favoriteIds();
    if (opts.optimistic) {
      const next = new Set(prev);
      next.add(eventId);
      this._favoriteIds.set(next);
    }
    try {
      await this.writeFavorite(uid, eventId);
    } catch (e) {
      console.error('[event-favourites] save failed', e);
      if (opts.optimistic && this.uid === uid) {
        this._favoriteIds.set(prev);
      }
    }
  }

  private async removeFavorite(
    uid: string,
    eventId: string,
    opts: { optimistic: boolean }
  ): Promise<void> {
    const prev = this._favoriteIds();
    if (opts.optimistic) {
      const next = new Set(prev);
      next.delete(eventId);
      this._favoriteIds.set(next);
    }
    try {
      await this.deleteFavorite(uid, eventId);
    } catch (e) {
      console.error('[event-favourites] remove failed', e);
      if (opts.optimistic && this.uid === uid) {
        this._favoriteIds.set(prev);
      }
    }
  }

  private clearLegacySharedStorage(): void {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Ignore quota / private-mode failures; this key is no longer used.
    }
  }
}

function isSafeEventId(eventId: string): boolean {
  return typeof eventId === 'string' && eventId.length > 0 && !eventId.includes('/');
}
