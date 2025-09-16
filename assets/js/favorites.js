/* assets/js/favorites.js  (UK spelling for Firestore paths)
   Requires:
   - firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
   - auth.js must initialize Firebase app first
   - Optional HTML for a side panel: #favourites-panel, #favourites-list, #fav-auth-hint
   - Provides:
       window.circeco.mountHeartButton(btn, place)
       window.circeco.favorites.bindMapSource({ map, sourceId: 'favorites' })
       window.circeco.favorites.getAll()
       window.circeco.favorites.isFavorite(placeId)
     (Alias: window.circeco.favourites points to the same object)
*/

(() => {
  'use strict';

  const fb = window.firebase;
  if (!fb || !fb.apps || !fb.apps.length) {
    console.error('[favorites] Firebase not initialized. Ensure auth.js runs first.');
    return;
  }

  const auth = fb.auth();
  const db   = fb.firestore();

  // ---------- Firestore helpers (UK path) ----------
  function favDoc(uid, placeId) {
    return db.collection('users').doc(uid).collection('favourites').doc(String(placeId));
  }

  async function saveFavourite(uid, place) {
    // place = { id, name, coords:{lat,lng}, address? }
    if (!place || !place.id || !place.name || !place.coords) throw new Error('INVALID_PLACE');

    const payload = {
      name: place.name,
      coords: { lat: Number(place.coords.lat), lng: Number(place.coords.lng) },
      address: place.address || '',
      serverCreatedAt: fb.firestore.FieldValue.serverTimestamp(),
      clientCreatedAt: new Date()
    };
    // Idempotent write
    await favDoc(uid, place.id).set(payload, { merge: true });
  }

  async function removeFavourite(uid, placeId) {
    await favDoc(uid, placeId).delete();
  }

  async function isFavourite(uid, placeId) {
    const snap = await favDoc(uid, placeId).get();
    return snap.exists;
  }

  // ---------- Optional panel DOM ----------
  const panelEl = document.getElementById('favourites-panel');
  const listEl  = document.getElementById('favourites-list');
  const hintEl  = document.getElementById('fav-auth-hint');

  function ensurePanelVisible() {
    if (panelEl && panelEl.style.display !== 'block') panelEl.style.display = 'block';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
  }

  function centerMap(coords) {
    try {
      if (window.circeco?.map && coords) {
        window.circeco.map.flyTo({ center: [coords.lng, coords.lat], zoom: 14 });
      }
    } catch (e) {}
  }

  function openAuthModalFallback() {
    const m = document.getElementById('authModal');
    if (m) m.style.display = 'flex';
  }

  // ---------- Heart registry + sync ----------
  const heartRegistry = new Map(); // placeId -> Set<HTMLButtonElement>
  function registerHeart(placeId, btn) {
    if (!placeId || !btn) return;
    if (!heartRegistry.has(placeId)) heartRegistry.set(placeId, new Set());
    heartRegistry.get(placeId).add(btn);
  }
  function updateHearts(placeId, isFav) {
    const set = heartRegistry.get(placeId);
    if (!set) return;
    set.forEach(btn => {
      btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      btn.textContent = isFav ? '♥' : '♡';
    });
  }

  // ---------- Render favourites panel ----------
  function renderFavourites(items) {
    if (!panelEl || !listEl) return;
    ensurePanelVisible();
    listEl.innerHTML = '';

    items.sort((a, b) => {
      const as = a.serverCreatedAt?.seconds ?? 0;
      const bs = b.serverCreatedAt?.seconds ?? 0;
      if (bs !== as) return bs - as;
      const ac = (a.clientCreatedAt ? new Date(a.clientCreatedAt).getTime() : 0);
      const bc = (b.clientCreatedAt ? new Date(b.clientCreatedAt).getTime() : 0);
      return bc - ac;
    });

    items.forEach((f) => {
      const li = document.createElement('li');

      const go = document.createElement('button');
      go.className = 'btn btn-sm btn-outline-secondary';
      go.title = 'Center map here';
      go.textContent = '📍';
      go.addEventListener('click', () => centerMap(f.coords));

      const label = document.createElement('div');
      label.style.flex = '1';
      const name = escapeHtml(f.name);
      const sub  = escapeHtml(f.address || `${Number(f.coords?.lat).toFixed(4)}, ${Number(f.coords?.lng).toFixed(4)}`);
      label.innerHTML = `<strong>${name}</strong><br><small>${sub}</small>`;

      const del = document.createElement('button');
      del.className = 'btn btn-sm btn-outline-danger';
      del.title = 'Remove';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        const u = auth.currentUser;
        if (!u) return;
        try {
          await removeFavourite(u.uid, f.id);
          updateHearts(f.id, false);
          window.dispatchEvent(new CustomEvent('favorites:changed', { detail: { placeId: f.id, isFav: false } }));
        } catch (e) {
          console.error('[favorites] delete failed', e);
        }
      });

      li.appendChild(go);
      li.appendChild(label);
      li.appendChild(del);
      listEl.appendChild(li);
    });
  }

  // ---------- Live listener bound to auth state ----------
  let unsubscribe = null;
  let cachedFavourites = []; // array of {id, name, coords:{lat,lng}, address, serverCreatedAt?, clientCreatedAt?}

  function emitAuthEvent(user) {
    try {
      window.dispatchEvent(new CustomEvent('favorites:auth', { detail: { user: user ? { uid: user.uid, email: user.email || null } : null }}));
    } catch (_) {}
  }

  auth.onAuthStateChanged((user) => {
    if (hintEl) {
      hintEl.textContent = user ? '' : 'Sign in to save';
    }

    emitAuthEvent(user);

    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    cachedFavourites = [];
    if (user) {
      unsubscribe = db.collection('users')
        .doc(user.uid)
        .collection('favourites')                   // 👈 UK path
        .orderBy('serverCreatedAt', 'desc')
        .onSnapshot(
          (snap) => {
            const items = [];
            snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
            cachedFavourites = items;
            renderFavourites(items);
            try {
              window.dispatchEvent(new CustomEvent('favorites:update', { detail: { items } }));
            } catch (_) {}
          },
          (err) => {
            console.error('[favorites] Snapshot error', err);
            cachedFavourites = [];
            renderFavourites([]);
            try {
              window.dispatchEvent(new CustomEvent('favorites:update', { detail: { items: [] } }));
            } catch (_) {}
          }
        );
    } else {
      ensurePanelVisible();
      renderFavourites([]);
      try {
        window.dispatchEvent(new CustomEvent('favorites:update', { detail: { items: [] } }));
      } catch (_) {}
    }
  });

  // ---------- Public: heart button ----------
  async function mountHeartButton(btnEl, place) {
    // place must be: { id, name, coords:{lat,lng}, address? }
    if (!btnEl || !place || !place.id) return;

    btnEl.classList.add('heart-btn');
    btnEl.setAttribute('aria-label', 'Save to favourites');
    btnEl.setAttribute('aria-pressed', 'false');
    btnEl.textContent = '♡';

    registerHeart(place.id, btnEl);

    const u = auth.currentUser;
    if (u) {
      try {
        const exists = await isFavourite(u.uid, place.id);
        btnEl.setAttribute('aria-pressed', exists ? 'true' : 'false');
        btnEl.textContent = exists ? '♥' : '♡';
      } catch (_) {}
    }

    btnEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();

      const user = auth.currentUser;
      if (!user) {
        if (window.circeco?.openAuthModal) window.circeco.openAuthModal(); else openAuthModalFallback();
        try { window.dispatchEvent(new Event('favorites:auth-required')); } catch (_) {}
        return;
      }

      const pressed = btnEl.getAttribute('aria-pressed') === 'true';

      if (pressed) {
        // optimistic remove
        btnEl.setAttribute('aria-pressed', 'false');
        btnEl.textContent = '♡';
        try {
          await removeFavourite(user.uid, place.id);
          updateHearts(place.id, false);
          window.dispatchEvent(new CustomEvent('favorites:changed', { detail: { placeId: place.id, isFav: false } }));
        } catch (e) {
          btnEl.setAttribute('aria-pressed', 'true');
          btnEl.textContent = '♥';
          console.error('[favorites] remove failed', e);
        }
      } else {
        // optimistic save
        btnEl.setAttribute('aria-pressed', 'true');
        btnEl.textContent = '♥';
        try {
          await saveFavourite(user.uid, place);
          updateHearts(place.id, true);
          window.dispatchEvent(new CustomEvent('favorites:changed', { detail: { placeId: place.id, isFav: true } }));
        } catch (e) {
          btnEl.setAttribute('aria-pressed', 'false');
          btnEl.textContent = '♡';
          if (e && e.code === 'permission-denied') {
            console.warn('Permission denied saving favourites. Are you signed in (and email verified, if required)?');
          }
          console.error('[favorites] save failed', e);
        }
      }
    });
  }

  // Optional helper: Mapbox feature → place
  function buildPlaceFromFeature(feat) {
    try {
      const coords = Array.isArray(feat?.geometry?.coordinates)
        ? { lng: Number(feat.geometry.coordinates[0]), lat: Number(feat.geometry.coordinates[1]) }
        : { lng: Number(feat?.center?.[0]), lat: Number(feat?.center?.[1]) };

      return {
        id: String(
          feat?.id
          || feat?.properties?.id
          || `${feat?.layer?.id || 'feat'}:${feat?.properties?.STORE_NAME || feat?.properties?.name || feat?.text || 'unknown'}:${coords.lng},${coords.lat}`
        ),
        name: feat?.properties?.STORE_NAME || feat?.text || feat?.properties?.name || 'Unknown place',
        coords,
        address: feat?.properties?.ADDRESS_LINE1 || feat?.place_name || feat?.properties?.address || '',
      };
    } catch (_) {
      return null;
    }
  }

  // ---------- Mapbox integration (kept) ----------
  let boundMap = null;
  let boundSourceId = null;

  function favouriteRecordToFeature(rec){
    return {
      id: rec.id,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(rec.coords.lng), Number(rec.coords.lat)] },
      properties: {
        STORE_NAME: rec.name || 'Unknown place',
        ADDRESS_LINE1: rec.address || '',
        DESCRIPTION: '',
        STORE_TYPE: 'Favorite',
        WEB: ''
      }
    };
  }

  function pushFavouritesToMapSource() {
    if (!boundMap || !boundSourceId) return;
    try {
      const src = boundMap.getSource(boundSourceId);
      if (!src) return;
      const feats = (cachedFavourites || [])
        .filter(r => r?.coords && typeof r.coords.lng !== 'undefined' && typeof r.coords.lat !== 'undefined')
        .map(favouriteRecordToFeature);
      src.setData({ type:'FeatureCollection', features: feats });
    } catch (e) {
      console.warn('[favorites] Could not update bound map source', e);
    }
  }

  function bindMapSource({ map, sourceId = 'favorites' }) {
    boundMap = map || null;
    boundSourceId = sourceId || null;
    pushFavouritesToMapSource();
    const handler = () => pushFavouritesToMapSource();
    window.addEventListener('favorites:update', handler);
    return () => window.removeEventListener('favorites:update', handler);
  }

  // ---------- Expose public API ----------
  window.circeco = window.circeco || {};
  window.circeco.mountHeartButton = mountHeartButton;
  window.circeco.buildPlaceFromFeature = buildPlaceFromFeature;

  // Keep "favorites" namespace for compatibility, but use UK path internally
  window.circeco.favorites = {
    getAll: () => cachedFavourites.slice(),
    isFavorite: async (placeId) => {
      const u = auth.currentUser;
      if (!u) return false;
      return isFavourite(u.uid, placeId);
    },
    bindMapSource
  };
  // UK alias if you want to reference it elsewhere
  window.circeco.favourites = window.circeco.favorites;

  // Signal ready
  try { window.dispatchEvent(new Event('favorites-ready')); } catch (_) {}
})();


