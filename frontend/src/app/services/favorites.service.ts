import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore, collection, doc, setDoc, deleteDoc, query, orderBy,
} from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { Subscription } from 'rxjs';

import { AuthService } from './auth.service';

type Coords = { lng: number; lat: number };
type Place = {
  key: string;
  name: string;
  address?: string;
  coords: Coords;
  legacyId?: string;
};

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private fs = inject(Firestore);
  private auth = inject(Auth);                // read current user quickly
  private authSvc = inject(AuthService);      // user$ stream + modal bridge

  // in-memory cache (key -> Place)
  private cache = new Map<string, Place>();
  private hearts = new Map<string, Set<HTMLButtonElement>>(); // key -> buttons
  private favSub?: Subscription;

  constructor() {
    // 1) Global API for legacy map/list code
    const g = window as any;
    g.circeco = g.circeco || {};
    g.circeco.favorites = g.circeco.favorites || {};
    g.circeco.favorites.mountHeartButton = (btn: HTMLButtonElement, placeOrFeature: any) =>
      this.mountHeartButton(btn, placeOrFeature);
    g.circeco.favorites.buildPlaceFromFeature = (f: any) => this.buildPlaceFromFeature(f);
    g.circeco.favorites.computePlaceKey = (p: any) => this.computePlaceKey(p);
    g.circeco.favourites = g.circeco.favorites; // UK alias
    try { window.dispatchEvent(new Event('favorites-ready')); } catch {}

    // 2) React to auth changes: enable/disable UI, live-sync from Firestore
    this.authSvc.user$.subscribe(user => {
      this.updateFavoritesToggleLink(!!user);
      this.cache.clear();
      this.pushToMapSource();
      this.emitUpdate();

      // stop previous listener
      this.favSub?.unsubscribe();
      this.favSub = undefined;

      if (!user) return;

      const col = collection(this.fs, `users/${user.uid}/favourites`);
      const q = query(col, orderBy('serverCreatedAt', 'desc'));
      this.favSub = collectionData(q, { idField: 'id' }).subscribe({
        next: (docs: any[]) => {
          this.cache.clear();
          for (const d of docs) {
            const coords = d?.coords && isFiniteNum(d.coords.lat) && isFiniteNum(d.coords.lng)
              ? d.coords
              : (isFiniteNum(d.lat) && isFiniteNum(d.lng) ? { lat: d.lat, lng: d.lng } : null);

            if (!coords) continue;
            const name = d?.name || 'Unknown place';
            const address = d?.address || '';
            const legacyId = d?.id;
            const key = d?.key || this.computePlaceKey({ name, address, coords, legacyId });
            if (!key) continue;

            this.cache.set(key, { key, name, address, coords, legacyId });
          }
          this.pushToMapSource();
          this.emitUpdate();
          // refresh heart glyphs
          this.hearts.forEach((set, key) => set.forEach(btn => this.setHeart(btn, this.cache.has(key))));
        },
        error: (err) => {
          console.error('[favourites] snapshot error', err);
          this.cache.clear();
          this.pushToMapSource();
          this.emitUpdate();
        }
      });
    });
  }

  // ---------- public helpers (same signatures as legacy) ----------
  computePlaceKey(input: Partial<Place>) {
    const n = normString(input.name);
    const a = normString(input.address);
    if (n && a) return `nameaddr|${n}|${a}`;
    const c = input.coords;
    if (c && isFiniteNum(c.lng) && isFiniteNum(c.lat)) {
      return `coords|${Number(c.lng).toFixed(6)},${Number(c.lat).toFixed(6)}`;
    }
    if (input.legacyId) return `id|${String(input.legacyId)}`;
    return null;
  }

  buildPlaceFromFeature(feat: any): Place | null {
    try {
      const coords: Coords = Array.isArray(feat?.geometry?.coordinates)
        ? { lng: Number(feat.geometry.coordinates[0]), lat: Number(feat.geometry.coordinates[1]) }
        : { lng: Number(feat?.center?.[0]), lat: Number(feat?.center?.[1]) };

      const name =
        feat?.properties?.STORE_NAME ||
        feat?.properties?.NAME ||
        feat?.text ||
        'Unknown place';

      const address =
        feat?.properties?.ADDRESS_LINE1 ||
        feat?.properties?.ADDRESS ||
        feat?.place_name ||
        '';

      const legacyId = String(
        feat?.id ||
        feat?.properties?.id ||
        `${feat?.layer?.id || 'feat'}:${name}:${coords.lng},${coords.lat}`
      );

      const key = this.computePlaceKey({ name, address, coords, legacyId });
      if (!key) return null;

      return { key, name, address, coords, legacyId };
    } catch {
      return null;
    }
  }

  // ---------- hearts ----------
  async mountHeartButton(btn: HTMLButtonElement, placeOrFeature: any) {
    if (!btn || !placeOrFeature) return;

    // Normalize to Place
    let place: Place | null = null;
    if (placeOrFeature.geometry || placeOrFeature.properties) {
      place = this.buildPlaceFromFeature(placeOrFeature);
    } else {
      const p = placeOrFeature as Partial<Place>;
      const key = p.key || this.computePlaceKey(p);
      if (key && p.coords) place = { key, name: p.name || 'Unknown place', address: p.address || '', coords: p.coords, legacyId: p.legacyId };
    }
    btn.classList.add('heart-btn');
    btn.setAttribute('aria-label','Save to favourites');

    if (!place) {
      btn.setAttribute('disabled','true');
      btn.setAttribute('data-tip','Cannot save this place');
      btn.textContent = '♡';
      return;
    }

    // registry + initial state
    if (!this.hearts.has(place.key)) this.hearts.set(place.key, new Set());
    this.hearts.get(place.key)!.add(btn);
    this.setHeart(btn, this.cache.has(place.key));

    // click behavior
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const user = this.auth.currentUser;
      if (!user) {
        (window as any).circeco?.openAuthModal?.();
        return;
      }
      const isFav = this.cache.has(place!.key);
      if (isFav) {
        await this.removeFavorite(user.uid, place!.key, { optimistic: true });
      } else {
        await this.addFavorite(user.uid, place!, { optimistic: true });
      }
    }, { passive: false });
  }

  // ---------- Firestore ops with optimistic UI ----------
  private async addFavorite(uid: string, place: Place, opts: { optimistic: boolean }) {
    if (opts.optimistic) {
      this.cache.set(place.key, place);
      this.updateHearts(place.key, true);
      this.pushToMapSource(); this.emitUpdate();
    }
    try {
      await setDoc(doc(this.fs, `users/${uid}/favourites/${place.key}`), {
        key: place.key,
        name: place.name,
        address: place.address || '',
        coords: { lat: Number(place.coords.lat), lng: Number(place.coords.lng) },
        serverCreatedAt: serverTimestamp(),
        clientCreatedAt: new Date(),
      }, { merge: true });
    } catch (e) {
      console.error('[favourites] save failed', e);
      if (opts.optimistic) {
        this.cache.delete(place.key);
        this.updateHearts(place.key, false);
        this.pushToMapSource(); this.emitUpdate();
      }
    }
  }

  private async removeFavorite(uid: string, key: string, opts: { optimistic: boolean }) {
    const prev = this.cache.get(key);
    if (opts.optimistic) {
      this.cache.delete(key);
      this.updateHearts(key, false);
      this.pushToMapSource(); this.emitUpdate();
    }
    try {
      await deleteDoc(doc(this.fs, `users/${uid}/favourites/${key}`));
    } catch (e) {
      console.error('[favourites] remove failed', e);
      if (opts.optimistic && prev) {
        this.cache.set(key, prev);
        this.updateHearts(key, true);
        this.pushToMapSource(); this.emitUpdate();
      }
    }
  }

  // ---------- UI + Map sync ----------
  private updateHearts(key: string, fav: boolean) {
    const set = this.hearts.get(key);
    if (!set) return;
    set.forEach(btn => this.setHeart(btn, fav));
  }
  private setHeart(btn: HTMLElement, fav: boolean) {
    btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    btn.textContent = fav ? '♥' : '♡';
  }

  private pushToMapSource() {
    const map = (window as any).circeco?.map;
    if (!map) return;
    try {
      const src = map.getSource('favorites');
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: Array.from(this.cache.values()).map(toFeature).filter(Boolean),
      });
    } catch (e) {
      console.warn('[favourites] map source update failed', e);
    }
  }

  private emitUpdate() {
    try {
      window.dispatchEvent(new CustomEvent('favorites:update', { detail: { items: Array.from(this.cache.values()) } }));
    } catch {}
  }

  private updateFavoritesToggleLink(isAuthed: boolean) {
    const map = (window as any).circeco?.map;
    const favLink = document.getElementById('favorites-toggle');
    if (!favLink) return;

    if (!isAuthed) {
      favLink.classList.remove('active');
      favLink.setAttribute('aria-disabled','true');
      favLink.setAttribute('data-tip','Sign in to save favourites');
      try {
        if (map && map.getLayer('favorites') && map.getLayoutProperty('favorites','visibility') === 'visible') {
          map.setLayoutProperty('favorites','visibility','none');
        }
      } catch {}
    } else {
      favLink.removeAttribute('aria-disabled');
      favLink.removeAttribute('data-tip');
      // don't force it visible; keep the last user choice
    }
  }
}

/* ---------- small utilities (same as legacy) ---------- */
function normString(s: any) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[,\.;:]+$/, '');
}
function isFiniteNum(n: any) { return typeof n === 'number' && isFinite(n); }
function toFeature(rec: Place | null) {
  if (!rec?.coords) return null;
  return {
    id: rec.key,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(rec.coords.lng), Number(rec.coords.lat)] },
    properties: {
      STORE_NAME: rec.name || 'Unknown place',
      ADDRESS_LINE1: rec.address || '',
      DESCRIPTION: '',
      STORE_TYPE: 'Favorite',
      WEB: '',
    }
  };
}
