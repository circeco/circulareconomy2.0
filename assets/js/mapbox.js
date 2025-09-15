/*----------Mapbox code ----------*/

mapboxgl.accessToken = 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

// Define Constants 
const stockholm = [18.072, 59.325];
const home = stockholm;
const myLayers = ['apparel', 'home', 'cycling-sports', 'electronics-books-music', 'favorites']; // Include 'favorites' as a regular layer id

let bounds = [
  [15.072078, 58.247414], // Southwest coordinates
  [19.180375, 60.008548]  // Northeast coordinates
];

// Add the map to the page
var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
  center: [18.072, 59.325],
  zoom: 10,
  maxBounds: bounds
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Expose map; also ensure we have a modal opener fallback
window.circeco = window.circeco || {};
window.circeco.map = map;
if (!window.circeco.openAuthModal) {
  window.circeco.openAuthModal = function () {
    var m = document.getElementById('authModal');
    if (m) m.style.display = 'flex';
  };
}

/* ---------- HEART SYNC (popup/list) ---------- */
const heartRegistry = {}; // placeId -> [buttons]
function registerHeart(placeId, btn){
  if (!heartRegistry[placeId]) heartRegistry[placeId] = [];
  heartRegistry[placeId].push(btn);
}
window.addEventListener('favorites:changed', function(e){
  const d = e.detail || {};
  const buttons = heartRegistry[d.placeId] || [];
  buttons.forEach((btn) => {
    btn.setAttribute('aria-pressed', d.isFav ? 'true' : 'false');
    btn.textContent = d.isFav ? '♥' : '♡';
  });
});

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

function favoriteRecordToFeature(rec){
  // rec: { id, name, coords:{lat,lng}, address }
  return {
    id: rec.id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(rec.coords.lng), Number(rec.coords.lat)] },
    layer: { id: 'favorites' },
    properties: {
      STORE_NAME: rec.name || 'Unknown place',
      ADDRESS_LINE1: rec.address || '',
      DESCRIPTION: '',
      STORE_TYPE: 'Favorite',
      WEB: ''
    }
  };
}

function getAuthUserSafe() {
  try {
    var fb = window.firebase;
    if (fb && fb.apps && fb.apps.length) return fb.auth().currentUser || null;
  } catch (_) {}
  return null;
}

/* ---------- Popup content (title + heart inline) ---------- */
function buildPopupContentFromFeature(feat){
  const place = featureToPlace(feat);
  const props = feat.properties || {};

  const el = document.createElement('div');

  // header: title + heart side-by-side
  const header = document.createElement('div');
  header.className = 'popup-header';

  const h = document.createElement('h4');
  h.style.margin = '0';
  h.textContent = place.name;

  const btn = document.createElement('button');
  btn.className = 'heart-btn';
  // avoid closing the popup; favorites.js toggles and stops propagation
  btn.addEventListener('click', function(ev){ ev.stopPropagation(); });
  if (window.circeco && window.circeco.mountHeartButton) {
    window.circeco.mountHeartButton(btn, place);
  } else {
    btn.textContent = '♡';
  }
  registerHeart(place.id, btn);

  header.appendChild(h);
  header.appendChild(btn);
  el.appendChild(header);

  // type line
  const pt = document.createElement('p');
  pt.style.margin = '4px 0';
  pt.textContent = props['STORE_TYPE'] || '';
  el.appendChild(pt);

  // website link (if present)
  const web = (props['WEB'] || '').replace(/^https?:\/\//i, '');
  if (web) {
    const a = document.createElement('a');
    a.target = '_blank';
    a.href = 'http://' + web;
    a.textContent = web;
    el.appendChild(a);
  }

  return el;
}

/* ---------- Map: add sources & layers ---------- */
map.on('load', function () {
  // existing sources/layers…
  map.addSource('tilequery', {
    type: "geojson",
    data: {"type": "FeatureCollection","features": []},
    cluster: true, clusterMaxZoom: 14, clusterRadius: 50
  });

  map.addSource('home', { type: 'vector', url: 'mapbox://circeco.ck6utkdky0iro2ls4ea12cku4-9rs0u' });
  map.addLayer({
    id: 'home', type: 'circle', source: 'home', 'source-layer': 'home',
    layout: { 'visibility': 'visible' },
    paint: {
      'circle-radius': 5,
      "circle-color": [
        'match', ['get', 'STORE_TYPE'],
        'reuse', '#FF5252',
        'recycle', 'rgb(69, 129, 142)',
        'refuse', '#FF8C00',
        'rethink', '#9ACD32',
        'remake', '#008000',
        'repair', '#008000',
        'rgb(69, 129, 142)'
      ]
    },
  });

  map.addSource('apparel', { type: 'vector', url: 'mapbox://circeco.ck6tfz7pg09ir2llh3r0k51sw-7yihy' });
  map.addLayer({
    id: 'apparel', type: 'circle', source: 'apparel', 'source-layer': 'apparel',
    layout: { 'visibility': 'visible' },
    paint: {
      'circle-radius': 5,
      "circle-color": [
        'match', ['get', 'STORE_TYPE'],
        'reuse', '#FF5252',
        'recycle', 'rgb(69, 129, 142)',
        'refuse', '#FF8C00',
        'rethink', '#9ACD32',
        'remake', '#008000',
        'repair', '#008000',
        'rgb(69, 129, 142)'
      ]
    },
  });

  map.addSource('electronics-books-music', { type: 'vector', url: 'mapbox://circeco.ck734j37i04g42kmu1h0oqvkd-7yswd' });
  map.addLayer({
    id: 'electronics-books-music', type: 'circle', source: 'electronics-books-music', 'source-layer': 'electronics-books-music',
    layout: { 'visibility': 'visible' },
    paint: {
      'circle-radius': 5,
      "circle-color": [
        'match', ['get', 'STORE_TYPE'],
        'reuse', '#FF5252',
        'recycle', 'rgb(69, 129, 142)',
        'refuse', '#FF8C00',
        'rethink', '#9ACD32',
        'remake', '#008000',
        'repair', '#008000',
        'rgb(69, 129, 142)'
      ]
    },
  });

  map.addSource('cycling-sports', { type: 'vector', url: 'mapbox://circeco.ck7357fhw00cz2lphq8pl19l6-7kbhr' });
  map.addLayer({
    id: 'cycling-sports', type: 'circle', source: 'cycling-sports', 'source-layer': 'cycling-sports',
    layout: { 'visibility': 'visible' },
    paint: {
      'circle-radius': 5,
      "circle-color": [
        'match', ['get', 'STORE_TYPE'],
        'reuse', '#FF5252',
        'recycle', 'rgb(69, 129, 142)',
        'refuse', '#FF8C00',
        'rethink', '#9ACD32',
        'remake', '#008000',
        'repair', '#008000',
        'rgb(69, 129, 142)'
      ]
    },
  });

  // NEW: Favorites as a real layer (starts hidden if signed-out)
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
      'circle-color': '#FF5252' // brand red for favorites
    }
  });
});

/* ---------- Popups ---------- */
let allFeatures = [];

function popUp(e) {
  const feat = e.features[0];
  var coordinates = feat.geometry.coordinates.slice();

  while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
  }

  const contentEl = buildPopupContentFromFeature(feat);

  new mapboxgl.Popup()
    .setLngLat(coordinates)
    .setDOMContent(contentEl)
    .addTo(map);
}

/* ---------- Idle: refresh visible features & bind handlers ---------- */
let listenersBound = false;
const listings = document.getElementById('listings');
const filterBox = document.getElementById('feature-filter');

map.on('idle', function () {
  // Only features that are actually rendered (respect visibility) are returned
  allFeatures = map.queryRenderedFeatures({ layers: myLayers });

  // Build deduped list for current filter
  buildLocationList(applyCurrentFilterToFeatures());

  // bind interactions once for ALL layers including favorites
  if (!listenersBound) {
    for (let i=0;i<myLayers.length;i++){
      const layerId = myLayers[i];
      map.on('click', layerId, popUp);
      map.on('mouseenter', layerId, function(){ map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, function(){ map.getCanvas().style.cursor = ''; });
    }
    listenersBound = true;
  }
});

/* ---------- De-duplication for the left list ---------- */
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
      if (exFav && !isFav) {
        mapByKey[key] = f;
      }
    }
  }
  return Object.values(mapByKey);
}

/* ---------- Build the left list (from currently visible, deduped layers) ---------- */
function buildLocationList(features) { 
  listings.innerHTML = '';

  const deduped = dedupeFeatures(features);

  deduped.forEach(function (feature, i) {
    const prop = feature.properties || {};
    const place = featureToPlace(feature);

    // container
    const listing = listings.appendChild(document.createElement('div'));
    listing.id = "listing-" + i;
    listing.className = 'item';

    // header: name + heart
    const header = document.createElement('div');
    header.className = 'listing-header';

    const title = document.createElement('div');
    title.className = 'stockholmlist';
    title.id = "link-" + i;
    title.textContent = prop['STORE_NAME'] || '';

    const heart = document.createElement('button');
    heart.className = 'heart-btn';
    if (window.circeco && window.circeco.mountHeartButton) {
      window.circeco.mountHeartButton(heart, place);
    } else {
      heart.textContent = '♡';
    }
    registerHeart(place.id, heart);

    header.appendChild(title);
    header.appendChild(heart);
    listing.appendChild(header);

    // details (address/description)
    const addr = document.createElement('h6');
    addr.textContent = prop['ADDRESS_LINE1'] || '';
    listing.appendChild(addr);

    const desc = document.createElement('p');
    desc.textContent = prop['DESCRIPTION'] || '';
    listing.appendChild(desc);

    // click row → fly + popup
    listing.addEventListener('click', function () {
      flyToStore(feature);
      createPopUp(feature);
    });
  });
}

/* ---------- Filter box ---------- */
function applyCurrentFilterToFeatures(){
  const typedValue = (filterBox && filterBox.value ? filterBox.value : '').trim().toLowerCase();
  let visible = allFeatures.slice();
  if (typedValue) {
    visible = visible.filter(function(feature){
      const descri = ((feature.properties['DESCRIPTION'] || '')+'').trim().toLowerCase();
      const storeName = ((feature.properties['STORE_NAME'] || '')+'').trim().toLowerCase();
      return descri.indexOf(typedValue) >= 0 || storeName.indexOf(typedValue) >= 0;
    });
  }
  return dedupeFeatures(visible);
}

if (filterBox) {
  filterBox.addEventListener('keyup', function(){
    buildLocationList(applyCurrentFilterToFeatures());
  });
}

/* ---------- Fly + create popup ---------- */
function flyToStore(currentFeature) {
  map.flyTo({ center: currentFeature.geometry.coordinates, zoom: 14 });
}

function createPopUp(currentFeature) {
  const popUps = document.getElementsByClassName('mapboxgl-popup');
  if (popUps[0]) popUps[0].remove();

  const contentEl = buildPopupContentFromFeature(currentFeature);

  new mapboxgl.Popup({ closeOnClick: true })
    .setLngLat(currentFeature.geometry.coordinates)
    .setDOMContent(contentEl)
    .addTo(map);
}

/* ---------- Layer toggles ---------- */
var layersNav = document.getElementById('selectlayers');

// 1) Favorites toggle FIRST (above apparel), auth-aware
var favLink = document.createElement('a');
favLink.href = '#';
favLink.id = 'favorites-toggle';
favLink.textContent = 'favorites ♥︎';
setFavLinkVisualDisabled(!getAuthUserSafe());
favLink.onclick = function(e){
  e.preventDefault(); e.stopPropagation();
  var user = getAuthUserSafe();
  if (!user) {
    // Open modal instead of doing anything
    return window.circeco.openAuthModal();
  }
  // Toggle favorites layer visibility
  var vis = map.getLayoutProperty('favorites', 'visibility');
  if (vis === 'visible') {
    map.setLayoutProperty('favorites', 'visibility', 'none');
    favLink.className = '';
  } else {
    map.setLayoutProperty('favorites', 'visibility', 'visible');
    favLink.className = 'active';
  }
  buildLocationList(applyCurrentFilterToFeatures());
};
layersNav.appendChild(favLink);

// 2) The rest of the layer toggles
var toggleableLayerIds = ['apparel', 'home', 'cycling-sports', 'electronics-books-music'];
for (var i = 0; i < toggleableLayerIds.length; i++) {
  (function(){
    var id = toggleableLayerIds[i];
    var link = document.createElement('a');
    link.href = '#';
    link.className = 'active'; // default visible like original
    link.textContent = id;

    link.onclick = function (e) {
      var clickedLayer = this.textContent;
      e.preventDefault();
      e.stopPropagation();

      var visibility = map.getLayoutProperty(clickedLayer, 'visibility');

      if (visibility === 'visible') {
        map.setLayoutProperty(clickedLayer, 'visibility', 'none');
        this.className = '';
      } else {
        map.setLayoutProperty(clickedLayer, 'visibility', 'visible');
        this.className = 'active';
      }

      // Rebuild the list immediately so it reflects the new visibility and dedupe state
      buildLocationList(applyCurrentFilterToFeatures());
    };

    layersNav.appendChild(link);
  })();
}

/* helper to visually disable/enable the favorites toggle */
function setFavLinkVisualDisabled(disabled){
  if (!favLink) return;

  if (disabled) {
    favLink.classList.remove('active');
    favLink.setAttribute('aria-disabled', 'true');
    favLink.setAttribute('title', 'Sign in to save Favorites');   // ← tooltip
    favLink.style.opacity = '0.5';
    favLink.style.cursor = 'not-allowed';
    // Hide the favorites layer if it was visible
    try {
      if (map.getLayer('favorites') && map.getLayoutProperty('favorites','visibility') === 'visible') {
        map.setLayoutProperty('favorites','visibility','none');
      }
    } catch(_){}
  } else {
    favLink.removeAttribute('aria-disabled');
    favLink.removeAttribute('title'); // ← remove tooltip
    favLink.style.opacity = '';
    favLink.style.cursor = '';
  }
  // Rebuild to reflect any visibility change
  buildLocationList(applyCurrentFilterToFeatures());
}


/* ---------- Favorites source updater from Firestore + auth UI state ---------- */
// Wait for Firebase to be initialized (auth.js must run first).
(function attachFavoritesToFirestore(tries){
  try {
    var fb = window.firebase;
    if (!fb || !fb.apps || !fb.apps.length) throw new Error('no-app-yet');

    var auth = fb.auth();
    var db   = fb.firestore();

    var favUnsub = null;

    // keep favorites toggle enabled/disabled with auth state
    auth.onAuthStateChanged(function(user){
      setFavLinkVisualDisabled(!user);

      if (favUnsub) { favUnsub(); favUnsub = null; }
      // clear source on sign-out
      var src0 = map.getSource('favorites');
      if (src0) src0.setData({ type:'FeatureCollection', features: [] });

      if (user) {
        favUnsub = db.collection('users').doc(user.uid).collection('favorites')
          .orderBy('createdAt', 'desc')
          .onSnapshot(function(snap){
            var feats = [];
            snap.forEach(function(d){
              var rec = d.data();
              rec.id = d.id;
              if (rec && rec.coords && typeof rec.coords.lng !== 'undefined' && typeof rec.coords.lat !== 'undefined') {
                feats.push(favoriteRecordToFeature(rec));
              }
            });
            var src = map.getSource('favorites');
            if (src) src.setData({ type:'FeatureCollection', features: feats });
            // Rebuild list so the column updates, deduping against other layers
            buildLocationList(applyCurrentFilterToFeatures());
          }, function(err){
            console.error('[favorites] snapshot error', err);
          });
      }
    });
  } catch (e) {
    // Firebase not ready yet; try again shortly (for up to ~5s)
    if ((tries || 0) < 100) {
      return setTimeout(function(){ attachFavoritesToFirestore((tries||0)+1); }, 50);
    } else {
      console.warn('[favorites] Firebase not initialized; Favorites layer will remain empty.');
    }
  }
})();

