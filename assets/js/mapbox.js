/* ---------- assets/js/mapbox.js (refactored to work with favorites.js) ---------- */

mapboxgl.accessToken = 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

// Constants
const stockholm = [18.072, 59.325];
const LAYER_IDS = ['apparel', 'home', 'cycling-sports', 'electronics-books-music', 'favorites'];

const BOUNDS = [
  [15.072078, 58.247414], // SW
  [19.180375, 60.008548]  // NE
];

const CATEGORY_CIRCLE_PAINT = {
  'circle-radius': 5,
  'circle-color': [
    'match', ['get', 'STORE_TYPE'],
    'reuse',   '#FF5252',
    'recycle', 'rgb(69, 129, 142)',
    'refuse',  '#FF8C00',
    'rethink', '#9ACD32',
    'remake',  '#008000',
    'repair',  '#008000',
    'rgb(69, 129, 142)'
  ]
};

// Map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
  center: stockholm,
  zoom: 10,
  maxBounds: BOUNDS
});
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Expose map + modal fallback
window.circeco = window.circeco || {};
window.circeco.map = map;
if (!window.circeco.openAuthModal) {
  window.circeco.openAuthModal = function () {
    const m = document.getElementById('authModal');
    if (m) m.style.display = 'flex';
  };
}

/* ---------- Helpers ---------- */
function featureToPlace(feat){
  const p = feat.properties || {};
  const coords = (feat && feat.geometry && feat.geometry.coordinates) ? feat.geometry.coordinates : [0,0];
  const name = p['STORE_NAME'] || p['NAME'] || 'Unknown place';
  const id = String(
    feat.id || p.id || p.ID || ((feat.layer && feat.layer.id) + ':' + name + ':' + coords[0] + ',' + coords[1])
  );
  return {
    id,
    name,
    coords: { lng: Number(coords[0]), lat: Number(coords[1]) },
    address: p['ADDRESS_LINE1'] || p['ADDRESS'] || ''
  };
}

function normalizeWebHref(raw){
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^https?:\/\//i, '');
}

/* ---------- Popup content (title + heart inline) ---------- */
function buildPopupContentFromFeature(feat){
  const place = featureToPlace(feat);
  const props = feat.properties || {};

  const el = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'popup-header';

  const h = document.createElement('h4');
  h.style.margin = '0';
  h.textContent = place.name;

  const btn = document.createElement('button');
  btn.className = 'heart-btn';
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', (ev) => ev.stopPropagation()); // don’t close popup
  if (window.circeco?.mountHeartButton) {
    window.circeco.mountHeartButton(btn, place);
  } else {
    btn.textContent = '♡';
  }

  header.appendChild(h);
  header.appendChild(btn);
  el.appendChild(header);

  if (props['STORE_TYPE']) {
    const pt = document.createElement('p');
    pt.style.margin = '4px 0';
    pt.textContent = props['STORE_TYPE'];
    el.appendChild(pt);
  }

  const rawWeb = (props['WEB'] || '').replace(/^https?:\/\//i, '');
  const href = normalizeWebHref(rawWeb);
  if (href) {
    const a = document.createElement('a');
    a.target = '_blank';
    a.rel = 'noopener';
    a.href = href;
    a.textContent = rawWeb;
    el.appendChild(a);
  }

  return el;
}

/* ---------- Map: add sources & layers ---------- */
let favoritesBound = false;

map.on('load', function () {
  // Vector layers
  map.addSource('home', { type: 'vector', url: 'mapbox://circeco.ck6utkdky0iro2ls4ea12cku4-9rs0u' });
  map.addLayer({
    id: 'home', type: 'circle', source: 'home', 'source-layer': 'home',
    layout: { 'visibility': 'visible' },
    paint: CATEGORY_CIRCLE_PAINT,
  });

  map.addSource('apparel', { type: 'vector', url: 'mapbox://circeco.ck6tfz7pg09ir2llh3r0k51sw-7yihy' });
  map.addLayer({
    id: 'apparel', type: 'circle', source: 'apparel', 'source-layer': 'apparel',
    layout: { 'visibility': 'visible' },
    paint: CATEGORY_CIRCLE_PAINT,
  });

  map.addSource('electronics-books-music', { type: 'vector', url: 'mapbox://circeco.ck734j37i04g42kmu1h0oqvkd-7yswd' });
  map.addLayer({
    id: 'electronics-books-music', type: 'circle', source: 'electronics-books-music', 'source-layer': 'electronics-books-music',
    layout: { 'visibility': 'visible' },
    paint: CATEGORY_CIRCLE_PAINT,
  });

  map.addSource('cycling-sports', { type: 'vector', url: 'mapbox://circeco.ck7357fhw00cz2lphq8pl19l6-7kbhr' });
  map.addLayer({
    id: 'cycling-sports', type: 'circle', source: 'cycling-sports', 'source-layer': 'cycling-sports',
    layout: { 'visibility': 'visible' },
    paint: CATEGORY_CIRCLE_PAINT,
  });

  // Favorites as a real layer (starts hidden if signed-out)
  map.addSource('favorites', {
    type: 'geojson',
    data: { type:'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'favorites',
    type: 'circle',
    source: 'favorites',
    layout: { 'visibility': 'none' }, // default hidden; user can enable after sign-in
    paint: {
      'circle-radius': 5,
      'circle-color': '#FF5252'
    }
  });

  // Bind favorites.js → Mapbox source (now favorites.js owns Firestore)
  function tryBindFavorites(){
    if (favoritesBound) return;
    if (window.circeco?.favorites?.bindMapSource) {
      window.circeco.favorites.bindMapSource({ map, sourceId: 'favorites' });
      favoritesBound = true;
      rebuildListNow();
    }
  }
  tryBindFavorites();
  // In case favorites.js loads later:
  window.addEventListener('favorites-ready', tryBindFavorites);
});

/* ---------- Popups ---------- */
function showPopupAt(feature, lngLat){
  const contentEl = buildPopupContentFromFeature(feature);
  new mapboxgl.Popup({ closeOnClick: true })
    .setLngLat(lngLat || feature.geometry.coordinates)
    .setDOMContent(contentEl)
    .addTo(map);
}

function onMapFeatureClick(e){
  if (!e.features || !e.features.length) return;
  const feat = e.features[0];
  const coordinates = feat.geometry && feat.geometry.coordinates ? feat.geometry.coordinates.slice() : [e.lngLat.lng, e.lngLat.lat];
  while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
  }
  showPopupAt(feat, coordinates);
}

/* ---------- Visible features & listings ---------- */
let allFeatures = [];
const listings = document.getElementById('listings');
const filterBox = document.getElementById('feature-filter');

function existingVisibleLayerIds(){
  return LAYER_IDS.filter(id => {
    try {
      return map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none';
    } catch (_) { return false; }
  });
}

function refreshAllFeatures(){
  try {
    const layerIds = existingVisibleLayerIds();
    allFeatures = map.queryRenderedFeatures({ layers: layerIds }) || [];
  } catch (_){
    allFeatures = [];
  }
}

function canonicalKeyForFeature(feature){
  try {
    const p = feature.properties || {};
    const name = (p['STORE_NAME'] || p['NAME'] || '').trim().toLowerCase();
    const coords = feature.geometry && feature.geometry.coordinates ? feature.geometry.coordinates : [0,0];
    const lng = Number(coords[0]).toFixed(6);
    const lat = Number(coords[1]).toFixed(6);
    return name + '|' + lng + ',' + lat;
  } catch (e) {
    return String(feature.id || Math.random());
  }
}

function dedupeFeatures(features){
  const mapByKey = Object.create(null);
  for (let i=0;i<features.length;i++){
    const f = features[i];
    const key = canonicalKeyForFeature(f);
    const existing = mapByKey[key];
    if (!existing) {
      mapByKey[key] = f;
    } else {
      const isFav = (f.layer && f.layer.id === 'favorites');
      const exFav = (existing.layer && existing.layer.id === 'favorites');
      // prefer NON-favorites for richer metadata
      if (exFav && !isFav) mapByKey[key] = f;
    }
  }
  return Object.values(mapByKey);
}

function applyCurrentFilterTo(features){
  const typedValue = (filterBox && filterBox.value ? filterBox.value : '').trim().toLowerCase();
  if (!typedValue) return dedupeFeatures(features);
  const visible = features.filter(function(feature){
    const p = feature.properties || {};
    const descr = ((p['DESCRIPTION'] || '')+'').trim().toLowerCase();
    const storeName = ((p['STORE_NAME'] || p['NAME'] || '')+'').trim().toLowerCase();
    const addr = ((p['ADDRESS_LINE1'] || p['ADDRESS'] || '')+'').trim().toLowerCase();
    return descr.includes(typedValue) || storeName.includes(typedValue) || addr.includes(typedValue);
  });
  return dedupeFeatures(visible);
}

function buildLocationList(features){
  if (!listings) return;
  listings.innerHTML = '';

  const deduped = dedupeFeatures(features)
    .sort((a,b) => {
      const an = ((a.properties && (a.properties.STORE_NAME || a.properties.NAME)) || '').toLowerCase();
      const bn = ((b.properties && (b.properties.STORE_NAME || b.properties.NAME)) || '').toLowerCase();
      return an.localeCompare(bn);
    });

  deduped.forEach(function (feature, i) {
    const p = feature.properties || {};
    const place = featureToPlace(feature);

    const listing = listings.appendChild(document.createElement('div'));
    listing.id = "listing-" + i;
    listing.className = 'item';

    const header = document.createElement('div');
    header.className = 'listing-header';

    const title = document.createElement('div');
    title.className = 'stockholmlist';
    title.id = "link-" + i;
    title.textContent = p['STORE_NAME'] || p['NAME'] || place.name;

    const heart = document.createElement('button');
    heart.className = 'heart-btn';
    heart.setAttribute('aria-pressed', 'false');
    heart.addEventListener('click', (ev) => ev.stopPropagation()); // don’t trigger row click
    if (window.circeco?.mountHeartButton) {
      window.circeco.mountHeartButton(heart, place);
    } else {
      heart.textContent = '♡';
    }

    header.appendChild(title);
    header.appendChild(heart);
    listing.appendChild(header);

    if (p['ADDRESS_LINE1'] || p['ADDRESS']) {
      const addr = document.createElement('p');
      addr.className = 'address';
      addr.textContent = p['ADDRESS_LINE1'] || p['ADDRESS'] || '';
      listing.appendChild(addr);
    }

    if (p['DESCRIPTION']) {
      const desc = document.createElement('p');
      desc.textContent = p['DESCRIPTION'] || '';
      listing.appendChild(desc);
    }

    listing.addEventListener('click', function () {
      if (!feature.geometry || !feature.geometry.coordinates) return;
      map.flyTo({ center: feature.geometry.coordinates, zoom: 14 });
      showPopupAt(feature);
    });
  });
}

// Debounced rebuild
let rebuildPending = false;
function rebuildListNow(){
  refreshAllFeatures();
  const filtered = applyCurrentFilterTo(allFeatures);
  buildLocationList(filtered);
}
function rebuildListSoon(){
  if (rebuildPending) return;
  rebuildPending = true;
  requestAnimationFrame(() => {
    rebuildPending = false;
    rebuildListNow();
  });
}

/* ---------- Bind map interactions (once) ---------- */
let listenersBound = false;
map.on('idle', function () {
  rebuildListSoon();

  if (!listenersBound) {
    LAYER_IDS.forEach(layerId => {
      map.on('click', layerId, onMapFeatureClick);
      map.on('mouseenter', layerId, function(){ map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, function(){ map.getCanvas().style.cursor = ''; });
    });
    listenersBound = true;
  }
});

/* ---------- Filter box ---------- */
if (filterBox) {
  filterBox.addEventListener('input', rebuildListNow);
}

/* ---------- Layer toggles ---------- */
const layersNav = document.getElementById('selectlayers');
let favLink = null;

function setFavLinkVisualDisabled(disabled){
  if (!favLink) return;

  if (disabled) {
    favLink.classList.remove('active');
    favLink.setAttribute('aria-disabled', 'true');
    favLink.setAttribute('title', 'Sign in to save Favorites');
    favLink.style.opacity = '0.5';
    favLink.style.cursor = 'not-allowed';
    try {
      if (map.getLayer('favorites') && map.getLayoutProperty('favorites','visibility') === 'visible') {
        map.setLayoutProperty('favorites','visibility','none');
      }
    } catch(_){}
  } else {
    favLink.removeAttribute('aria-disabled');
    favLink.removeAttribute('title');
    favLink.style.opacity = '';
    favLink.style.cursor = '';
  }
  rebuildListNow();
}

function getAuthUserSafe() {
  try {
    const fb = window.firebase;
    if (fb && fb.apps && fb.apps.length) return fb.auth().currentUser || null;
  } catch (_) {}
  return null;
}

if (layersNav) {
  // Favorites toggle FIRST
  favLink = document.createElement('a');
  favLink.href = '#';
  favLink.id = 'favorites-toggle';
  favLink.textContent = 'favorites ♥︎';
  setFavLinkVisualDisabled(!getAuthUserSafe());
  favLink.onclick = function(e){
    e.preventDefault(); e.stopPropagation();
    const user = getAuthUserSafe();
    if (!user) {
      return window.circeco.openAuthModal();
    }
    const vis = map.getLayoutProperty('favorites', 'visibility');
    if (vis === 'visible') {
      map.setLayoutProperty('favorites', 'visibility', 'none');
      favLink.className = '';
    } else {
      map.setLayoutProperty('favorites', 'visibility', 'visible');
      favLink.className = 'active';
    }
    rebuildListNow();
  };
  layersNav.appendChild(favLink);

  // Other layer toggles
  ['apparel', 'home', 'cycling-sports', 'electronics-books-music'].forEach(id => {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'active';
    link.textContent = id;

    link.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();

      const visibility = map.getLayoutProperty(id, 'visibility');
      if (visibility === 'visible') {
        map.setLayoutProperty(id, 'visibility', 'none');
        this.className = '';
      } else {
        map.setLayoutProperty(id, 'visibility', 'visible');
        this.className = 'active';
      }
      rebuildListNow();
    };

    layersNav.appendChild(link);
  });
}

/* ---------- React to centralized favorites/auth events ---------- */
// Rebuild the list when favorites data changes (even if map doesn't re-render)
window.addEventListener('favorites:update', rebuildListNow);
// Keep favorites toggle enabled/disabled with centralized auth events
window.addEventListener('favorites:auth', (e) => {
  const user = e.detail?.user || null;
  setFavLinkVisualDisabled(!user);
});

