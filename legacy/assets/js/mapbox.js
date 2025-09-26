/* =========================================================
   assets/js/mapbox.js
   - Single places source: assets/data/circular_places.geojson
   - 'places' layer filtered by category toggles
   - 'favorites' GeoJSON source updated by favorites.js
   - Hearts auto-mount even if favorites.js loads after this file
   ========================================================= */
(function () {
  'use strict';

  // Guard against duplicate loads
  window.circeco = window.circeco || {};
  window.circeco.modules = window.circeco.modules || {};
  if (window.circeco.modules.mapboxInitialized) return;
  window.circeco.modules.mapboxInitialized = true;

  mapboxgl.accessToken = 'pk.eyJ1IjoiY2lyY2VjbyIsImEiOiJjazczN3docmowNjMwM2ZwZGFkand4YTUxIn0.0pNRz0t74QkAc6y5shG0BA';

  const STOCKHOLM = [18.072, 59.325];
  const BOUNDS = [[15.072078, 58.247414],[19.180375, 60.008548]];
  const CATEGORY_IDS = ['apparel','home','cycling-sports','electronics-books-music'];
  const QUERY_LAYER_IDS = ['places','favorites'];
  const enabledCategories = new Set(CATEGORY_IDS);

  const CATEGORY_CIRCLE_PAINT = {
    'circle-radius': 5,
    'circle-color': [
      'match', ['get', 'STORE_TYPE'],
      'reuse',   '#FF5252',
      'recycle', 'rgb(69,129,142)',
      'refuse',  '#FF8C00',
      'rethink', '#9ACD32',
      'remake',  '#008000',
      'repair',  '#008000',
      'rgb(69,129,142)'
    ]
  };

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/circeco/ck5zjodry0ujw1ioaiqvk9kjs',
    center: STOCKHOLM,
    zoom: 10,
    maxBounds: BOUNDS
  });
  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

  // Ignore empty sprite lookups coming from any stray symbol layer
  map.on('styleimagemissing', (e) => { if (!e.id) return; /* optionally load custom sprites here */ });

  window.circeco.map = map;
  if (!window.circeco.openAuthModal) {
    window.circeco.openAuthModal = () => {
      const m = document.getElementById('authModal');
      if (m) m.style.display = 'flex';
    };
  }

  // ---------- heart auto-mount queue ----------
  const heartMountQueue = [];
  function mountHeart(btn, place){
    // prevent the row click from firing
    btn.addEventListener('click', ev => ev.stopPropagation());
    const api = window.circeco?.favorites?.mountHeartButton;
    if (api) {
      api(btn, place);
      btn.dataset.heartMounted = '1';
    } else {
      // queue for when favorites.js signals readiness
      heartMountQueue.push({ btn, place });
      // show hollow heart for now
      btn.textContent = '♡';
    }
  }
  window.addEventListener('favorites-ready', () => {
    const api = window.circeco?.favorites?.mountHeartButton;
    if (!api) return;
    while (heartMountQueue.length) {
      const { btn, place } = heartMountQueue.shift();
      if (!btn.dataset.heartMounted) {
        api(btn, place);
        btn.dataset.heartMounted = '1';
      }
    }
  });

  // ---------- helpers ----------
  function normalizeWebHref(raw){
    const s = (raw || '').trim(); if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : ('https://' + s.replace(/^https?:\/\//i,''));
  }
  function existingQueryLayerIds({ visibleOnly=false } = {}){
    return QUERY_LAYER_IDS.filter(id => {
      try {
        if (!map.getLayer(id)) return false;
        return !visibleOnly || map.getLayoutProperty(id,'visibility') !== 'none';
      } catch { return false; }
    });
  }
  function buildPlacesFilterExpression(){
    if (enabledCategories.size === 0) return ['==',['literal',1],0];
    const tests = [];
    enabledCategories.forEach(cat => {
      tests.push(['in', cat, ['coalesce',['get','CATEGORIES'], ['literal',[]]]]);
      tests.push(['==', ['get','CATEGORY'], cat]);
    });
    return ['any', ...tests];
  }

  // Enrichment index (so favourites popups/list show rich info)
  const placesIndexByNameAddr = new Map();
  const placesIndexByCoord = new Map();
  let placesIndexReady = false;
  function normString(s){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/[,\.;:]+$/,''); }
  function kNA(name, addr){ const n=normString(name), a=normString(addr); return n && a ? `${n}|${a}` : ''; }
  function kC(lng, lat){ return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`; }
  function indexFeature(f){
    const p=f.properties||{};
    const name=p.STORE_NAME||p.NAME||'';
    const addr=p.ADDRESS_LINE1||p.ADDRESS||'';
    const c=f.geometry?.coordinates||[];
    const kna=kNA(name,addr); if (kna && !placesIndexByNameAddr.has(kna)) placesIndexByNameAddr.set(kna,f);
    if (c.length===2){ const kc=kC(c[0],c[1]); if (!placesIndexByCoord.has(kc)) placesIndexByCoord.set(kc,f); }
  }
  function buildIndex(fc){ try { (fc.features||[]).forEach(indexFeature); placesIndexReady=true; } catch { placesIndexReady=false; } }
  function enrichProps(feat){
    if (feat?.layer?.id !== 'favorites') return feat.properties || {};
    if (!placesIndexReady) return feat.properties || {};
    const p = feat.properties || {};
    const name = p.STORE_NAME || p.NAME || '';
    const addr = p.ADDRESS_LINE1 || p.ADDRESS || '';
    const c = feat.geometry?.coordinates || [];
    const base = (kNA(name,addr) && placesIndexByNameAddr.get(kNA(name,addr)))
              || (c.length===2 && placesIndexByCoord.get(kC(c[0],c[1])))
              || null;
    if (!base) return p;
    const bp = base.properties || {};
    return {
      ...bp,
      STORE_NAME: p.STORE_NAME || bp.STORE_NAME || bp.NAME || 'Unknown place',
      ADDRESS_LINE1: p.ADDRESS_LINE1 || bp.ADDRESS_LINE1 || bp.ADDRESS || ''
    };
  }

  function buildPlaceForHeart(feat){
    const p = enrichProps(feat);
    const c = feat.geometry?.coordinates || [0,0];
    const legacyId = String(feat?.id || feat?.properties?.id || `${feat?.layer?.id || 'feat'}:${p.STORE_NAME || p.NAME || 'Unknown'}:${c[0]},${c[1]}`);
    const place = {
      name: p.STORE_NAME || p.NAME || 'Unknown place',
      address: p.ADDRESS_LINE1 || p.ADDRESS || '',
      coords: { lng: Number(c[0]), lat: Number(c[1]) },
      legacyId
    };
    const fn = window.circeco?.favorites?.computePlaceKey;
    place.key = fn ? fn(place) : legacyId;
    return place;
  }

  function buildPopupContent(feat){
    const props = enrichProps(feat);
    const place  = buildPlaceForHeart({ ...feat, properties: props });

    const el = document.createElement('div');
    const header = document.createElement('div'); header.className='popup-header';

    const h = document.createElement('h4'); h.style.margin='0';
    h.textContent = props.STORE_NAME || props.NAME || 'Unknown place';

    const btn = document.createElement('button');
    btn.className = 'heart-btn';
    btn.setAttribute('aria-pressed','false');
    mountHeart(btn, place);

    header.appendChild(h); header.appendChild(btn); el.appendChild(header);

    if (props.STORE_TYPE) { const t=document.createElement('p'); t.style.margin='4px 0'; t.textContent=props.STORE_TYPE; el.appendChild(t); }
    if (props.ADDRESS_LINE1 || props.ADDRESS) { const a=document.createElement('p'); a.className='address'; a.textContent=props.ADDRESS_LINE1 || props.ADDRESS || ''; el.appendChild(a); }
    const rawWeb=(props.WEB||'').replace(/^https?:\/\//i,''); const href=normalizeWebHref(rawWeb);
    if (href){ const a=document.createElement('a'); a.target='_blank'; a.rel='noopener'; a.href=href; a.textContent=rawWeb; el.appendChild(a); }
    if (props.DESCRIPTION){ const d=document.createElement('p'); d.textContent=props.DESCRIPTION; el.appendChild(d); }

    return el;
  }

  // -------------------- Map sources & layers --------------------
  map.on('load', function () {
    // Absolute URL so it works from any routed page
    const DATA_URL = new URL('assets/data/circular_places.geojson', document.baseURI).toString();

    // Places source + index build (for richer popups/list)
    map.addSource('places', { type:'geojson', data: DATA_URL });
    fetch(DATA_URL).then(r=>r.json()).then(fc => { buildIndex(fc); rebuildListSoon(); }).catch(()=>{});

    map.addLayer({
      id: 'places', type:'circle', source:'places',
      layout:{ visibility:'visible' },
      paint: CATEGORY_CIRCLE_PAINT,
      filter: buildPlacesFilterExpression()
    });

    // Favorites source + layer
    map.addSource('favorites', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'favorites', type:'circle', source:'favorites',
      layout:{ visibility:'visible' },
      paint:{ 'circle-radius':5, 'circle-color':'#FF5252' }
    });

    // Single popup for both layers
    map.on('click', (e) => {
      const layers = existingQueryLayerIds({ visibleOnly:true });
      if (!layers.length) return;
      const feats = map.queryRenderedFeatures(e.point, { layers });
      if (!feats?.length) return;
      const best = feats.find(f => f.layer?.id !== 'favorites') || feats[0];

      const coords = best.geometry?.coordinates ? best.geometry.coordinates.slice() : [e.lngLat.lng, e.lngLat.lat];
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) coords[0] += (e.lngLat.lng > coords[0] ? 360 : -360);

      document.querySelector('.mapboxgl-popup')?.remove();
      new mapboxgl.Popup({ closeOnClick:true })
        .setLngLat(coords)
        .setDOMContent(buildPopupContent(best))
        .addTo(map);
    });

    map.on('mousemove', (e) => {
      const layers = existingQueryLayerIds({ visibleOnly:true });
      const feats = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      map.getCanvas().style.cursor = (feats && feats.length) ? 'pointer' : '';
    });

    buildLayerToggles();

    map.once('idle', () => rebuildListNow());
    map.on('idle', () => rebuildListSoon());
  });

  // -------------------- Listing (left column) --------------------
  let allFeatures = [];
  const listings = document.getElementById('listings');
  const filterBox = document.getElementById('feature-filter');

  function refreshAllFeatures(){
    try {
      const layerIds = existingQueryLayerIds({ visibleOnly:true });
      allFeatures = layerIds.length ? (map.queryRenderedFeatures({ layers: layerIds }) || []) : [];
    } catch { allFeatures = []; }
  }
  function canonicalKey(feature){
    try {
      const p = enrichProps(feature);
      const name = (p.STORE_NAME || p.NAME || '').trim().toLowerCase();
      const c = feature.geometry?.coordinates || [0,0];
      return `${name}|${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`;
    } catch { return String(feature.id || Math.random()); }
  }
  function dedupe(features){
    const byKey = Object.create(null);
    for (const f of features) {
      const k = canonicalKey(f);
      const prev = byKey[k];
      if (!prev) byKey[k] = f;
      else {
        const isFav = f.layer?.id === 'favorites';
        const prevFav = prev.layer?.id === 'favorites';
        if (prevFav && !isFav) byKey[k] = f; // prefer richer non-favourites
      }
    }
    return Object.values(byKey);
  }
  function applyFilter(features){
    const typed = (filterBox?.value || '').trim().toLowerCase();
    const list = dedupe(features);
    if (!typed) return list;
    return list.filter(f => {
      const p = enrichProps(f);
      const descr = (p.DESCRIPTION || '').toLowerCase();
      const name  = (p.STORE_NAME || p.NAME || '').toLowerCase();
      const addr  = (p.ADDRESS_LINE1 || p.ADDRESS || '').toLowerCase();
      return descr.includes(typed) || name.includes(typed) || addr.includes(typed);
    });
  }
  function buildLocationList(features){
    if (!listings) return;
    listings.innerHTML = '';

    const sorted = features.slice().sort((a,b) => {
      const ap = enrichProps(a), bp = enrichProps(b);
      const an = (ap.STORE_NAME || ap.NAME || '').toLowerCase();
      const bn = (bp.STORE_NAME || bp.NAME || '').toLowerCase();
      return an.localeCompare(bn);
    });

    sorted.forEach((feature, i) => {
      const props = enrichProps(feature);
      const place = buildPlaceForHeart({ ...feature, properties: props });

      const row = listings.appendChild(document.createElement('div'));
      row.id = 'listing-'+i; row.className='item';

      const header = document.createElement('div'); header.className='listing-header';

      const title = document.createElement('div'); title.className='stockholmlist'; title.id='link-'+i;
      title.textContent = props.STORE_NAME || props.NAME || 'Unknown place';

      const heart = document.createElement('button'); heart.className='heart-btn'; heart.setAttribute('aria-pressed','false');
      mountHeart(heart, place);

      header.appendChild(title); header.appendChild(heart); row.appendChild(header);

      if (props.ADDRESS_LINE1 || props.ADDRESS) {
        const addr = document.createElement('p'); addr.className='address';
        addr.textContent = props.ADDRESS_LINE1 || props.ADDRESS || '';
        row.appendChild(addr);
      }
      if (props.DESCRIPTION) {
        const desc = document.createElement('p'); desc.textContent = props.DESCRIPTION || '';
        row.appendChild(desc);
      }

      row.addEventListener('click', () => {
        if (!feature.geometry?.coordinates) return;
        map.flyTo({ center: feature.geometry.coordinates, zoom: 14 });
        document.querySelector('.mapboxgl-popup')?.remove();
        new mapboxgl.Popup({ closeOnClick:true })
          .setLngLat(feature.geometry.coordinates)
          .setDOMContent(buildPopupContent({ ...feature, properties: props }))
          .addTo(map);
      });
    });
  }
  let rebuildPending = false;
  function rebuildListNow(){ refreshAllFeatures(); buildLocationList(applyFilter(allFeatures)); }
  function rebuildListSoon(){ if (rebuildPending) return; rebuildPending=true; requestAnimationFrame(()=>{ rebuildPending=false; rebuildListNow(); }); }
  filterBox?.addEventListener('input', rebuildListNow);
  window.addEventListener('favorites:update', rebuildListSoon);

  // -------------------- Layer toggles --------------------
  const layersNav = document.getElementById('selectlayers');
  let favLink = null;

  function updatePlacesFilter(){ try { if (map.getLayer('places')) map.setFilter('places', buildPlacesFilterExpression()); } catch{} rebuildListSoon(); }
  function setFavLinkDisabled(disabled){
    if (!favLink) return;
    if (disabled) {
      favLink.classList.remove('active');
      favLink.setAttribute('aria-disabled','true');
      favLink.setAttribute('data-tip','Sign in to save favourites');
      try { if (map.getLayer('favorites') && map.getLayoutProperty('favorites','visibility')==='visible') map.setLayoutProperty('favorites','visibility','none'); } catch{}
    } else {
      favLink.removeAttribute('aria-disabled');
      favLink.removeAttribute('data-tip');
      try { if (map.getLayer('favorites')) { map.setLayoutProperty('favorites','visibility','visible'); favLink.classList.add('active'); } } catch{}
    }
    rebuildListSoon();
  }
  window.addEventListener('favorites:auth', (e) => setFavLinkDisabled(!e.detail?.user));

  function buildLayerToggles(){
    if (!layersNav) return;

    // Favourites first
    if (!favLink) {
      favLink = document.createElement('a');
      favLink.href = '#';
      favLink.id = 'favorites-toggle';
      favLink.textContent = 'favourites ♥︎';
      favLink.className = 'active';
      layersNav.appendChild(favLink);

      favLink.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        const disabled = favLink.getAttribute('aria-disabled') === 'true';
        if (disabled) return window.circeco.openAuthModal();

        const vis = map.getLayoutProperty('favorites','visibility');
        if (vis === 'visible') { map.setLayoutProperty('favorites','visibility','none'); favLink.className=''; }
        else { map.setLayoutProperty('favorites','visibility','visible'); favLink.className='active'; }
        rebuildListSoon();
      };
    }

    // Category toggles
    CATEGORY_IDS.forEach(cat => {
      const link = document.createElement('a');
      link.href='#';
      link.className = enabledCategories.has(cat) ? 'active' : '';
      link.textContent = cat;
      link.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        if (enabledCategories.has(cat)) { enabledCategories.delete(cat); this.className=''; }
        else { enabledCategories.add(cat); this.className='active'; }
        updatePlacesFilter();
      };
      layersNav.appendChild(link);
    });
  }
})();
