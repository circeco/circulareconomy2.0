/* ======================================================
   assets/js/favorites.js  (UK spelling)
   - Firebase auth + Firestore "favourites"
   - mountHeartButton(place|feature) for popups/list
   - Client cache + updates Mapbox 'favorites' source
   - Hearts (popup+list) stay in sync
   Requires:
     - firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
     - auth.js must initialise the Firebase app
   ====================================================== */
(() => {
  'use strict';

  // Prevent double init
  window.circeco = window.circeco || {};
  window.circeco.modules = window.circeco.modules || {};
  if (window.circeco.modules.favoritesInitialized) return;
  window.circeco.modules.favoritesInitialized = true;

  const fb = window.firebase;
  if (!fb || !fb.apps || !fb.apps.length) {
    console.error('[favourites] Firebase not initialised.');
    return;
  }
  const auth = fb.auth();
  const db   = fb.firestore();

  // ---------- utils ----------
  function normString(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[,\.;:]+$/, '');
  }
  function isFiniteNum(n){ return typeof n === 'number' && isFinite(n); }
  function computePlaceKey({ name, address, coords, legacyId }) {
    const n = normString(name);
    const a = normString(address);
    if (n && a) return `nameaddr|${n}|${a}`;
    if (coords && isFiniteNum(coords.lng) && isFiniteNum(coords.lat)) {
      return `coords|${coords.lng.toFixed(6)},${coords.lat.toFixed(6)}`;
    }
    if (legacyId) return `id|${String(legacyId)}`;
    return null;
  }
  function buildPlaceFromFeature(feat) {
    try {
      const coords = Array.isArray(feat?.geometry?.coordinates)
        ? { lng: Number(feat.geometry.coordinates[0]), lat: Number(feat.geometry.coordinates[1]) }
        : { lng: Number(feat?.center?.[0]), lat: Number(feat?.center?.[1]) };

      const name = feat?.properties?.STORE_NAME
        || feat?.properties?.NAME
        || feat?.text
        || 'Unknown place';

      const address = feat?.properties?.ADDRESS_LINE1
        || feat?.properties?.ADDRESS
        || feat?.place_name
        || '';

      const legacyId = String(
        feat?.id
        || feat?.properties?.id
        || `${feat?.layer?.id || 'feat'}:${name}:${coords.lng},${coords.lat}`
      );

      const place = { name, address, coords, legacyId };
      place.key = computePlaceKey(place);
      return place;
    } catch { return null; }
  }

  // ---------- Firestore (UK) ----------
  function favCol(uid){ return db.collection('users').doc(uid).collection('favourites'); }
  function favDoc(uid, key){ return favCol(uid).doc(String(key)); }

  // ---------- cache + map source ----------
  const cache = new Map(); // key -> { key,name,address,coords,... }
  const cacheList = () => Array.from(cache.values());

  function toFeature(rec){
    if (!rec?.coords) return null;
    return {
      id: rec.key,
      type: 'Feature',
      geometry: { type:'Point', coordinates: [Number(rec.coords.lng), Number(rec.coords.lat)] },
      properties: {
        STORE_NAME: rec.name || 'Unknown place',
        ADDRESS_LINE1: rec.address || '',
        DESCRIPTION: '',
        STORE_TYPE: 'Favorite',
        WEB: ''
      }
    };
  }

  function pushToMapSource(){
    const map = window.circeco?.map;
    if (!map) return;
    try {
      const src = map.getSource('favorites');
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: cacheList().map(toFeature).filter(Boolean)
      });
    } catch(e){ console.warn('[favourites] map source update failed', e); }
  }

  function emitUpdate(){
    try { window.dispatchEvent(new CustomEvent('favorites:update', { detail: { items: cacheList() } })); } catch {}
  }
  function emitAuth(user){
    try { window.dispatchEvent(new CustomEvent('favorites:auth', { detail: { user: user ? { uid:user.uid, email:user.email||null } : null } })); } catch {}
  }

  // ---------- heart registry ----------
  const heartRegistry = new Map(); // key -> Set<button>
  function registerHeart(key, btn){
    if (!key || !btn) return;
    if (!heartRegistry.has(key)) heartRegistry.set(key, new Set());
    heartRegistry.get(key).add(btn);
  }
  function setHeart(btn, fav){
    btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    btn.textContent = fav ? '♥' : '♡';
  }
  function updateHearts(key, fav){
    const set = heartRegistry.get(key);
    if (!set) return;
    set.forEach(btn => setHeart(btn, fav));
  }

  // ---------- public: mount heart ----------
  async function mountHeartButton(btnEl, placeInput){
    if (!btnEl || !placeInput) return;

    let place = placeInput;
    if (placeInput.geometry || placeInput.properties) {
      const built = buildPlaceFromFeature(placeInput);
      if (!built) return;
      place = built;
    } else if (!place.key) {
      const legacyId = place.legacyId || place.id || null;
      place.key = computePlaceKey({ ...place, legacyId });
    }
    if (!place?.key) {
      btnEl.classList.add('heart-btn');
      btnEl.setAttribute('disabled','true');
      btnEl.setAttribute('data-tip','Cannot save this place');
      btnEl.textContent = '♡';
      return;
    }

    btnEl.classList.add('heart-btn');
    btnEl.setAttribute('aria-label','Save to favourites');
    btnEl.setAttribute('aria-pressed','false');
    btnEl.textContent = '♡';

    registerHeart(place.key, btnEl);
    setHeart(btnEl, cache.has(place.key));

    btnEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();

      const user = auth.currentUser;
      if (!user) {
        if (window.circeco?.openAuthModal) return window.circeco.openAuthModal();
        const m = document.getElementById('authModal'); if (m) m.style.display='flex';
        return;
      }

      const pressed = btnEl.getAttribute('aria-pressed') === 'true';
      if (pressed) {
        // optimistic remove
        setHeart(btnEl, false);
        updateHearts(place.key, false);
        cache.delete(place.key);
        pushToMapSource(); emitUpdate();

        try {
          await favDoc(user.uid, place.key).delete();
        } catch(e) {
          // revert on failure
          cache.set(place.key, { key:place.key, name:place.name, address:place.address||'', coords:place.coords });
          pushToMapSource(); emitUpdate();
          setHeart(btnEl, true);
          updateHearts(place.key, true);
          console.error('[favourites] remove failed', e);
        }
      } else {
        // optimistic add
        setHeart(btnEl, true);
        updateHearts(place.key, true);
        cache.set(place.key, { key:place.key, name:place.name, address:place.address||'', coords:place.coords });
        pushToMapSource(); emitUpdate();

        try {
          await favDoc(user.uid, place.key).set({
            key: place.key,
            name: place.name,
            address: place.address || '',
            coords: { lat: Number(place.coords.lat), lng: Number(place.coords.lng) },
            serverCreatedAt: fb.firestore.FieldValue.serverTimestamp(),
            clientCreatedAt: new Date()
          }, { merge: true });
        } catch(e) {
          // revert on failure
          cache.delete(place.key);
          pushToMapSource(); emitUpdate();
          setHeart(btnEl, false);
          updateHearts(place.key, false);
          console.error('[favourites] save failed', e);
        }
      }
    });
  }

  // ---------- live listener ----------
  let unsub = null;
  auth.onAuthStateChanged((user) => {
    emitAuth(user);

    if (unsub) { try { unsub(); } catch{} unsub = null; }
    cache.clear(); pushToMapSource(); emitUpdate();

    try {
      const favLink = document.getElementById('favorites-toggle');
      if (favLink) {
        if (user) {
          favLink.removeAttribute('aria-disabled');
          favLink.removeAttribute('data-tip');
        } else {
          favLink.setAttribute('aria-disabled','true');
          favLink.setAttribute('data-tip','Sign in to save favourites');
          const map = window.circeco?.map;
          if (map && map.getLayer('favorites') && map.getLayoutProperty('favorites','visibility')==='visible') {
            map.setLayoutProperty('favorites','visibility','none');
            favLink.classList.remove('active');
          }
        }
      }
    } catch {}

    if (!user) return;

    unsub = favCol(user.uid)
      .orderBy('serverCreatedAt', 'desc')
      .onSnapshot(
        (snap) => {
          cache.clear();
          snap.forEach(d => {
            const data = d.data() || {};
            const coords = data.coords && isFiniteNum(data.coords.lat) && isFiniteNum(data.coords.lng)
              ? data.coords
              : (isFiniteNum(data.lat) && isFiniteNum(data.lng) ? { lat:data.lat, lng:data.lng } : null);

            const name = data.name || 'Unknown place';
            const address = data.address || '';
            const legacyId = d.id;
            const key = data.key || computePlaceKey({ name, address, coords, legacyId });
            if (!key) return;

            cache.set(key, { key, name, address, coords, serverCreatedAt: data.serverCreatedAt || null });
          });

          pushToMapSource(); emitUpdate();

          // update all known hearts
          heartRegistry.forEach((btns, key) => {
            const isFav = cache.has(key);
            btns.forEach(btn => setHeart(btn, isFav));
          });
        },
        (err) => {
          console.error('[favourites] snapshot error', err);
          cache.clear(); pushToMapSource(); emitUpdate();
        }
      );
  });

  // ---------- public API ----------
  window.circeco.favorites = window.circeco.favorites || {};
  window.circeco.favorites.mountHeartButton = mountHeartButton;
  window.circeco.favorites.buildPlaceFromFeature = buildPlaceFromFeature;
  window.circeco.favorites.computePlaceKey = computePlaceKey;
  window.circeco.favourites = window.circeco.favorites;

  try { window.dispatchEvent(new Event('favorites-ready')); } catch {}
})();


