/* assets/js/favorites.js
   Requires:
   - firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
   - Your auth.js should initialize Firebase app.
   - HTML must contain: #favourites-panel, #favourites-list, #fav-auth-hint (optional; safe if absent)
*/

(() => {
  'use strict';

  const fb = window.firebase;
  if (!fb || !fb.apps || !fb.apps.length) {
    console.error('[favorites] Firebase not initialized. Make sure auth.js runs before this file.');
    return;
  }

  const auth = fb.auth();
  const db   = fb.firestore();

  // ---- Firestore helpers ----
  function favDoc(uid, placeId) {
    return db.collection('users').doc(uid).collection('favorites').doc(String(placeId));
  }

  async function saveFavorite(uid, place) {
    // place = { id, name, coords:{lat,lng}, address? }
    if (!place || !place.id || !place.name || !place.coords) {
      throw new Error('INVALID_PLACE');
    }
    await favDoc(uid, place.id).set({
      name: place.name,
      coords: { lat: Number(place.coords.lat), lng: Number(place.coords.lng) },
      address: place.address || '',
      createdAt: fb.firestore.FieldValue.serverTimestamp(),
    }, { merge: false });
  }

  async function removeFavorite(uid, placeId) {
    await favDoc(uid, placeId).delete();
  }

  async function isFavorite(uid, placeId) {
    const snap = await favDoc(uid, placeId).get();
    return snap.exists;
  }

  // ---- DOM helpers ----
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
    } catch (e) {
      // no-op
    }
  }

  function openAuthModalFallback() {
    const m = document.getElementById('authModal');
    if (m) m.style.display = 'flex';
  }

  function renderFavourites(items) {
    if (!panelEl || !listEl) return;
    ensurePanelVisible();
    listEl.innerHTML = '';

    // newest first if createdAt is present
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

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
          await removeFavorite(u.uid, f.id);
          // notify all hearts (list + popup) to update
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

  // ---- Live listener bound to auth state ----
  let unsubscribe = null;

  auth.onAuthStateChanged((user) => {
    if (hintEl) {
      hintEl.textContent = user ? '' : 'Sign in to save';
    }

    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    if (user) {
      // Order by createdAt desc; if no data yet, it still works.
      unsubscribe = db.collection('users')
        .doc(user.uid)
        .collection('favorites')
        .orderBy('createdAt', 'desc')
        .onSnapshot(
          (snap) => {
            const items = [];
            snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
            renderFavourites(items);
          },
          (err) => {
            console.error('[favorites] Snapshot error', err);
            renderFavourites([]);
          }
        );
    } else {
      // Show empty state but keep panel visible so user sees the hint
      ensurePanelVisible();
      renderFavourites([]);
    }
  });

  // ---- Public API: heart button you can mount anywhere ----
  async function mountHeartButton(btnEl, place) {
    // place must be: { id, name, coords:{lat,lng}, address? }
    if (!btnEl || !place || !place.id) return;

    btnEl.classList.add('heart-btn');
    btnEl.setAttribute('aria-label', 'Save to favourites');
    btnEl.setAttribute('aria-pressed', 'false');
    btnEl.textContent = '♡';

    // Initialize visual state
    const u = auth.currentUser;
    if (u) {
      try {
        const exists = await isFavorite(u.uid, place.id);
        btnEl.setAttribute('aria-pressed', exists ? 'true' : 'false');
        btnEl.textContent = exists ? '♥' : '♡';
      } catch (_) {}
    }

    btnEl.addEventListener('click', async (ev) => {
      // prevent the row click in the list and any default
      ev.stopPropagation();
      ev.preventDefault();

      const user = auth.currentUser;
      if (!user) {
        if (window.circeco?.openAuthModal) return window.circeco.openAuthModal();
        openAuthModalFallback();
        return;
      }

      const pressed = btnEl.getAttribute('aria-pressed') === 'true';

      if (pressed) {
        // optimistic remove
        btnEl.setAttribute('aria-pressed', 'false');
        btnEl.textContent = '♡';
        try {
          await removeFavorite(user.uid, place.id);
          // broadcast change so any other heart for the same place updates
          window.dispatchEvent(new CustomEvent('favorites:changed', { detail: { placeId: place.id, isFav: false } }));
        } catch (e) {
          // revert on failure
          btnEl.setAttribute('aria-pressed', 'true');
          btnEl.textContent = '♥';
          console.error('[favorites] remove failed', e);
        }
      } else {
        // optimistic save
        btnEl.setAttribute('aria-pressed', 'true');
        btnEl.textContent = '♥';
        try {
          await saveFavorite(user.uid, place);
          // broadcast change so any other heart for the same place updates
          window.dispatchEvent(new CustomEvent('favorites:changed', { detail: { placeId: place.id, isFav: true } }));
        } catch (e) {
          // revert on failure
          btnEl.setAttribute('aria-pressed', 'false');
          btnEl.textContent = '♡';
          console.error('[favorites] save failed', e);
        }
      }
    });
  }

  // Optional helper: build a place object from a Mapbox feature
  function buildPlaceFromFeature(feat) {
    try {
      const coords = Array.isArray(feat?.geometry?.coordinates)
        ? { lng: Number(feat.geometry.coordinates[0]), lat: Number(feat.geometry.coordinates[1]) }
        : { lng: Number(feat?.center?.[0]), lat: Number(feat?.center?.[1]) };

      return {
        id: String(
          feat?.id
          || feat?.properties?.id
          || `${feat?.layer?.id || 'feat'}:${feat?.properties?.name || feat?.text || 'unknown'}:${coords.lng},${coords.lat}`
        ),
        name: feat?.text || feat?.properties?.name || 'Unknown place',
        coords,
        address: feat?.place_name || feat?.properties?.address || '',
      };
    } catch (_) {
      return null;
    }
  }

  // Expose public API
  window.circeco = window.circeco || {};
  window.circeco.mountHeartButton = mountHeartButton;
  window.circeco.buildPlaceFromFeature = buildPlaceFromFeature;
  window.circeco.saveFavorite = (place) => {
    const u = auth.currentUser;
    if (!u) return Promise.reject(new Error('AUTH_REQUIRED'));
    return saveFavorite(u.uid, place);
  };

  // (Optional) signal that favorites API is ready
  try { window.dispatchEvent(new Event('favorites-ready')); } catch (_) {}
})();
