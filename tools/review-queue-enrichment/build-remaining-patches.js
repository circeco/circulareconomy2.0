/* eslint-disable no-console */
/** One-shot builder: remaining snapshot places → patch objects using OSM/Nominatim + research overrides. */
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const meta = JSON.parse(readFileSync(path.join(__dirname, 'osm-meta.json'), 'utf8'));
const existing = JSON.parse(readFileSync(path.join(__dirname, 'patches.json'), 'utf8'));
const done = new Set(existing.map((p) => p.id));

const COORD_RE = /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/;
function isCoord(a) {
  return !a || COORD_RE.test(String(a).trim()) || /^Sample address/i.test(String(a));
}

function canonicalizeActionTags(inputs) {
  const ACTION = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'];
  const out = [];
  for (const v of inputs || []) {
    for (const part of String(v).split(/[;|,]/)) {
      const raw = part.trim().toLowerCase();
      const n =
        raw === 'reporpouse' ? 'repurpose'
        : raw === 'rethink' ? 'refuse'
        : raw === 'refurbish' || raw === 'refurnish' ? 'repair'
        : raw === 'remanufacture' || raw === 'remanifacture' ? 'repurpose'
        : raw === 'share' || raw === 'rental' ? 'reuse'
        : raw;
      if (ACTION.includes(n) && !out.includes(n)) out.push(n);
    }
  }
  return out.slice(0, 2);
}

function canonicalizeSectors(inputs) {
  const out = [];
  for (const v of inputs || []) {
    const raw = String(v).trim().toLowerCase().replace(/\s+/g, '-');
    let n = null;
    if (raw === 'apparel' || raw === 'clothing' || raw === 'accessories') n = 'apparel';
    else if (raw === 'home-garden' || raw === 'home' || raw === 'furniture' || raw === 'antiques') n = 'home-garden';
    else if (raw === 'cycling-sports' || raw === 'sport' || raw === 'sports' || raw === 'cycling') n = 'cycling-sports';
    else if (raw === 'electronics') n = 'electronics';
    else if (raw === 'books-comics-magazines' || raw === 'books' || raw === 'comics' || raw === 'magazines') n = 'books-comics-magazines';
    else if (raw === 'music') n = 'music';
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

const CITY_LABEL = { milan: 'Milan', stockholm: 'Stockholm', turin: 'Turin', uppsala: 'Uppsala' };

const OVERRIDES = {
  osm_milan_node_11230010248: {
    description: 'Libraccio Navigli: used and new books in the historic Navigli complex.',
    address: 'Alzaia Naviglio Grande 26, 20144 Milano',
    website: 'https://negozi.libraccio.it/negozi/milano/libraccio-corsico',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['duplicate_chain'],
    sources: ['https://negozi.libraccio.it/negozi/milano/libraccio-corsico', 'https://www.openstreetmap.org/node/11230010248'],
    notes: 'Another OSM node on the same Navigli Libraccio complex.',
  },
  osm_milan_node_4294302831: {
    description: 'Libraccio Navigli (Via Corsico entrance): used and new books.',
    website: 'https://negozi.libraccio.it/negozi/milano/libraccio-corsico',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['duplicate_chain'],
    sources: ['https://negozi.libraccio.it/negozi/milano/libraccio-corsico'],
    notes: 'Duplicate of Via Corsico 9 / Alzaia Naviglio Grande complex.',
  },
  osm_milan_node_11728146520: {
    flags: ['uncertain'],
    actionTags: ['reuse'],
    sectorCategories: [],
    sources: ['https://www.openstreetmap.org/node/11728146520'],
    notes: 'OSM shop=second_hand at Viale Sarca 193, but public listings for that address are an event space. Do not invent a circular story.',
  },
  osm_milan_node_4608448203: {
    description: 'Mercatino Scalo Merci: vintage furniture, modernariato and household objects near Milano Centrale.',
    address: 'Via Domenico Scarlatti 30, 20124 Milano',
    actionTags: ['reuse'],
    sectorCategories: ['home-garden'],
    sources: ['https://www.conoscounposto.com/negozi-mercatini-arredamento-vintage-milano/', 'https://www.openstreetmap.org/node/4608448203'],
    notes: 'Listings use Scarlatti 30; OSM had 32 next door.',
  },
  osm_milan_node_9761760511: {
    description: 'Open-air flea market (Pulci e non solo) for vintage objects, clothes and collectors’ items.',
    address: 'Via Emilia 1, 20097 San Donato Milanese',
    actionTags: ['reuse'],
    sectorCategories: [],
    sources: ['http://www.pulcienonsolo.it/', 'https://www.comune.sandonatomilanese.mi.it/vivere-san-donato-milanese/eventi/pulci-e-non-solo'],
    notes: 'Periodic Sunday market at ENI/Snam parking, not a daily shop.',
  },
  osm_milan_way_125835754: {
    description: 'Municipal recycling centre (piattaforma ecologica) in Rozzano.',
    address: "Via dell'Ecologia, 20089 Rozzano",
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_1432594216: {
    description: 'AMSA recycling centre on Via Olgettina.',
    address: 'Via Olgettina, 20132 Milano',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_193444070: {
    description: 'Municipal recycling centre (piattaforma ecologica) in Cesano Boscone.',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_326209629: {
    description: 'Municipal recycling centre in Sesto San Giovanni.',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_534201587: {
    description: 'CUSL student cooperative shop at UNIMI Settore Didattico: stationery, printing and some used textbooks.',
    address: 'Via Giuseppe Celoria 20, 20133 Milano',
    website: 'https://cusl.fondazionesun.com/',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['uncertain'],
    sources: ['https://cusl.fondazionesun.com/', 'https://www.openstreetmap.org/way/534201587'],
    notes: 'Primary offer is stationery/printing; OSM marks second_hand=yes for books. Flagged uncertain.',
  },
  osm_milan_way_657325612: {
    description: 'AMSA / Novate Milanese municipal recycling centre (centro di raccolta).',
    address: 'Via Quattro Novembre, 20026 Novate Milanese',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_90606252: {
    description: 'Municipal recycling centre (isola ecologica) in Segrate.',
    address: 'Via Rugacesio, 20054 Segrate',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_milan_way_93275814: {
    description: 'Municipal recycling centre (piattaforma ecologica) in Cormano.',
    address: 'Via Giacomo Brodolini, 20032 Cormano',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_stockholm_node_2777888879: {
    address: 'Högbergsgatan, 118 55 Stockholm',
    actionTags: [],
    sectorCategories: [],
    flags: ['off_concept'],
    sources: ['https://www.openstreetmap.org/node/2777888879', 'https://begravningsbyranhumana.se'],
    notes: 'OSM brand is Begravningsbyrån Humana (funeral directors), not HUMANA Second Hand. Clearing reuse tag.',
  },
  osm_stockholm_node_12581525954: {
    description: 'Re-tail second-hand shop for clothes and goods; drop-off accepted in store.',
    address: 'Sveavägen 6, 111 57 Stockholm',
    website: 'https://re-tail.se/pages/stockholm-jl',
    actionTags: ['reuse'],
    sectorCategories: ['apparel'],
    sources: ['https://re-tail.se/pages/stockholm-jl'],
  },
  osm_stockholm_node_13587940638: {
    description: 'Artikel2 (formerly Emmaus) charity second-hand shop in Solna Centrum.',
    address: 'Postgången 47 C, 171 45 Solna',
    website: 'https://artikel2.se/second-hand-solna/',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
    sources: ['https://artikel2.se/second-hand-solna/', 'https://solnacentrum.se/butik/artikel2/'],
  },
  osm_stockholm_node_14082299001: {
    description: 'Artikel2 Solna Centrum charity second-hand shop (duplicate OSM node).',
    address: 'Postgången 47 C, 171 45 Solna',
    website: 'https://artikel2.se/second-hand-solna/',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
    sources: ['https://artikel2.se/second-hand-solna/'],
    notes: 'Near-identical coordinates to the other Solna Artikel2 node.',
  },
  osm_stockholm_node_11010765225: {
    description: 'Artikel2 / Emmaus charity second-hand shop in Liljeholmstorget mall.',
    address: 'Liljeholmstorget 7, 117 63 Stockholm',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
    sources: ['https://emmausstockholm.se/second-hand-liljeholmen/'],
    notes: 'Website already on candidate (legacy Emmaus URL).',
  },
  osm_stockholm_node_7040625017: {
    description: 'Artikel2 charity second-hand shop (Solna / nearby mall node).',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
  },
  osm_turin_node_3147953824: null,
  osm_turin_node_8024246877: {
    address: 'Via Cesare Balbo, 10124 Torino',
    actionTags: [],
    sectorCategories: [],
    flags: ['off_concept'],
    sources: ['https://www.openstreetmap.org/node/8024246877'],
    notes: 'Self-service laundromat (Vintage Laundrette chain), not a vintage clothing shop. Clearing reuse tag.',
  },
  osm_turin_node_4734248857: {
    actionTags: [],
    sectorCategories: [],
    flags: ['off_concept'],
    sources: ['https://www.autonoleggidemartino.com/'],
    notes: 'Autonoleggi de Martino: conventional van/car hire (OSM rental=hgv). Clearing rental tag.',
  },
  osm_turin_node_12511867888: {
    address: 'Corso Filippo Turati, 10128 Torino',
    actionTags: [],
    sectorCategories: [],
    flags: ['off_concept'],
    sources: ['https://www.openstreetmap.org/node/12511867888'],
    notes: 'OSM name is Umana, an employment agency, not Humana second-hand. Snapshot name is a false match.',
  },
  osm_turin_node_1214095349: {
    description: 'Cashtime buys and resells used electronics, media, instruments and household objects for cash.',
    address: 'Via Paolo Sacchi 38, 10128 Torino',
    website: 'https://www.cashtime.it/il-negozio.html',
    actionTags: ['reuse'],
    sectorCategories: ['electronics'],
    sources: ['https://www.cashtime.it/il-negozio.html'],
  },
  osm_turin_node_12752045707: {
    description: 'Humana street clothing-collection point (donation container), 24/7.',
    actionTags: ['recycle'],
    sectorCategories: ['apparel'],
    sources: ['https://www.humanaitalia.org/'],
    notes: 'Collection outpost, not a shop.',
  },
  osm_turin_node_10896540917: {
    description: 'Humana Vintage Torino Via Po: second-hand and vintage clothing.',
    address: 'Via Po 39, 10124 Torino',
    website: 'https://humanavintage.it/',
    actionTags: ['reuse'],
    sectorCategories: ['apparel'],
    flags: ['duplicate_chain'],
    sources: ['https://www.humanaitalia.org/il-vintage-raddoppia-a-torino/'],
  },
  osm_turin_node_11280677238: {
    description: 'Libraccio Torino Via Ormea: used and new books and textbooks.',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['duplicate_chain'],
  },
  osm_turin_node_12995552841: {
    description: 'Libraccio Torino (Monginevro area): used and new books.',
    address: 'Via Monginevro, 10139 Torino',
    website: 'https://www.libraccio.it/',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['duplicate_chain'],
  },
  osm_uppsala_node_11495625482: {
    description: 'Uppsala Stadsmission outlet and donation drop-off in Boländerna.',
    address: 'Bolandsgatan 15C, 753 23 Uppsala',
    website: 'https://uppsalastadsmission.se/verksamheter/second-hand/',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
    sources: ['https://destinationuppsala.se/en/see-do-eat/second-hand-and-vintage-shops-in-uppsala/'],
  },
  osm_uppsala_node_3913032384: {
    description: 'Uppsala Stadsmission second-hand shop in Gottsunda Centrum.',
    address: 'Valthornsvägen 21, 756 50 Uppsala',
    website: 'https://uppsalastadsmission.se/verksamheter/second-hand/',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
  },
  osm_uppsala_node_4362452190: {
    description: 'Uppsala Stadsmission second-hand / social-enterprise shop.',
    address: 'Fyrisvallsgatan, 752 20 Uppsala',
    website: 'https://uppsalastadsmission.se/verksamheter/second-hand/',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
    flags_note: 'Street from Nominatim; confirm house number.',
  },
  osm_uppsala_node_8968640651: {
    description: 'Uppsala Stadsmission premium second-hand shop in Gränbystaden.',
    address: 'Marknadsgatan 1, 754 60 Uppsala',
    actionTags: ['reuse'],
    sectorCategories: [],
    flags: ['duplicate_chain'],
  },
  osm_uppsala_node_11495629999: {
    description: 'Uppsala Vatten municipal recycling centre in Fyrislund.',
    address: 'Arkgatan 14, 754 50 Uppsala',
    website: 'https://www.uppsalavatten.se/hushall/avfall-och-atervinning/avc3/oppettider-fyrislund-atervinningscentral',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_uppsala_way_94339237: {
    description: 'Uppsala Vatten municipal recycling centre in Gottsunda.',
    address: 'Elfrida Andreés väg, 756 50 Uppsala',
    website: 'https://www.uppsalavatten.se/hushall/avfall-och-atervinning/avc3/oppettider-gottsunda-atervinningscentral',
    actionTags: ['recycle'],
    sectorCategories: [],
  },
  osm_uppsala_node_10814296289: {
    description: 'Small political bookshop (Kommunistiska Partiet Uppsala) selling books, including second-hand titles.',
    actionTags: ['reuse'],
    sectorCategories: ['books-comics-magazines'],
    flags: ['uncertain'],
    notes: 'OSM second_hand=yes; also a party office. Website is the party site.',
  },
};

function pickAddress(p, override) {
  if (override && override.address) return override.address;
  const cur = p.current.address || '';
  const osmA = (p.osm && p.osm.osmAddress) || '';
  const nom = p.nominatimAddress || '';
  if (!isCoord(cur) && /\d/.test(cur)) return null; // keep existing street+number
  if (osmA && /\d/.test(osmA)) return osmA;
  if (!isCoord(cur) && cur.length > 5) return null;
  if (osmA) return osmA;
  if (nom) return nom;
  return null;
}

function pickWebsite(p, override) {
  if (override && Object.prototype.hasOwnProperty.call(override, 'website')) return override.website;
  const cur = p.current.website || '';
  const osmW = (p.osm && p.osm.website) || '';
  const prefer = osmW || cur;
  if (!prefer) return null;
  if (/facebook\.com|google\.[a-z]+\/search/i.test(prefer) && !cur) return null;
  if (prefer && prefer !== cur) return prefer;
  if (!cur && prefer) return prefer;
  return null;
}

function nameFlags(name) {
  const n = name.toLowerCase();
  const flags = [];
  if (/libraccio|humana|myrorna|artikel2|il mercatino|mercatino|stadsmission/i.test(name) && !/raccolta/.test(n)) {
    flags.push('duplicate_chain');
  }
  return flags;
}

function describe(p) {
  const name = p.name;
  const city = CITY_LABEL[p.cityId] || p.cityId;
  const shop = (p.osm && p.osm.shop) || '';
  const amenity = (p.osm && p.osm.amenity) || '';
  const tags = (p.osm && p.osm.tags) || {};
  const n = name.toLowerCase();

  if (amenity === 'recycling' || /ecocentro|piattaforma|isola ecologica|centro di raccolta|återvinnings|returpunkt|återvinning/i.test(name)) {
    return `Municipal recycling centre in ${city} for household sorted waste.`;
  }
  if (/libraccio/i.test(name)) return `Libraccio branch: used and new books, textbooks and comics in ${city}.`;
  if (/humana vintage/i.test(name)) return 'Humana Vintage shop selling selected second-hand and vintage clothing.';
  if (/^humana/i.test(name) && shop !== 'funeral_directors') return 'Humana charity second-hand clothing shop.';
  if (/myrorna/i.test(name)) return 'Myrorna (Salvation Army) charity second-hand shop.';
  if (/artikel2/i.test(name)) return 'Artikel2 (formerly Emmaus Stockholm) charity second-hand shop.';
  if (/stadsmission/i.test(name)) return `${name.replace(/second hand/i, '').trim()} charity second-hand shop for clothes and household goods.`;
  if (/röda korset|roda korset/i.test(name)) return 'Swedish Red Cross charity second-hand shop.';
  if (/il mercatino|mercatino dell/i.test(n) || n === 'il mercatino' || n === 'mercatino') {
    return "Il Mercatino dell'Usato franchise: second-hand furniture, household goods and clothing.";
  }
  if (/antikvariat|bokhandeln|libropoli|libro mastro|asino d'oro|lo straniero|serier/i.test(n) || shop === 'books') {
    return `${name} is a second-hand / antiquarian bookshop.`;
  }
  if (shop === 'clothes' || /vintage/i.test(n)) {
    return `${name} sells vintage and second-hand clothing.`;
  }
  if (shop === 'charity' || shop === 'second_hand') {
    return `${name} is a second-hand shop in ${city}.`;
  }
  if (tags.second_hand) return `${name} sells second-hand goods in ${city}.`;
  return `${name} in ${city}.`;
}

function pickSectors(p, actionTags) {
  const shop = (p.osm && p.osm.shop) || '';
  const cur = canonicalizeSectors(p.current.sectorCategories);
  if (cur.length) return cur;
  const n = p.name.toLowerCase();
  if (actionTags.includes('recycle')) return [];
  if (shop === 'books' || /antikvariat|libraccio|libropoli|libro |bok/i.test(n)) return ['books-comics-magazines'];
  if (shop === 'clothes' || /vintage|humana|abiti|cha\.rly|coquettes/i.test(n)) return ['apparel'];
  if (/mercatino|scalo merci|möbler|loppis.*möbel/i.test(n)) return ['home-garden'];
  if (shop === 'jewelry' || /accessories/.test((p.current.sectorCategories || []).join())) return ['apparel'];
  return [];
}

function osmSource(p) {
  if (!p.osm) return [];
  return [`https://www.openstreetmap.org/${p.osm.type}/${p.osm.osmId}`];
}

const remaining = meta.filter((p) => !done.has(p.id));
const out = [];
for (const p of remaining) {
  const ov = OVERRIDES[p.id];
  if (ov === null) continue;
  const flags = [...new Set([...(ov && ov.flags ? ov.flags : []), ...nameFlags(p.name)])];
  const proposed = {};
  const off = flags.includes('off_concept') || flags.includes('placeholder');

  if (ov && ov.description) proposed.description = ov.description;
  else if (!off && !flags.includes('uncertain') && !(p.current.description || '').trim()) {
    proposed.description = describe(p);
  } else if (!off && (p.current.description || '').trim() && ov && ov.description) {
    proposed.description = ov.description;
  }

  const addr = pickAddress(p, ov);
  if (addr) proposed.address = addr;

  const web = pickWebsite(p, ov);
  if (web) proposed.website = web;

  if (ov && ov.actionTags) proposed.actionTags = ov.actionTags;
  else proposed.actionTags = canonicalizeActionTags(p.current.actionTags);

  if (ov && ov.sectorCategories) proposed.sectorCategories = ov.sectorCategories;
  else proposed.sectorCategories = pickSectors(p, proposed.actionTags || []);

  if (off && !ov.actionTags) {
    proposed.actionTags = [];
    proposed.sectorCategories = [];
    delete proposed.description;
  }

  const unchanged = [];
  for (const k of ['description', 'address', 'website', 'actionTags', 'sectorCategories']) {
    if (!Object.prototype.hasOwnProperty.call(proposed, k)) unchanged.push(k);
  }

  const sources = [...new Set([...(ov && ov.sources ? ov.sources : []), ...osmSource(p)])];
  if (web) sources.push(web);
  if (p.current.website) sources.push(p.current.website);

  out.push({
    id: p.id,
    cityId: p.cityId,
    name: p.name,
    proposed,
    unchanged,
    flags,
    sources: sources.filter(Boolean).slice(0, 6),
    notes: (ov && ov.notes) || (flags.includes('uncertain') ? 'Could not fully confirm circular service; fields kept factual from OSM/Nominatim.' : ''),
  });
}

writeFileSync(path.join(__dirname, 'remaining-batch.json'), JSON.stringify(out, null, 2));
console.log('wrote remaining-batch.json', out.length);
const by = {};
for (const x of out) by[x.cityId] = (by[x.cityId] || 0) + 1;
console.log(by);
const flags = {};
for (const x of out) for (const f of x.flags || []) flags[f] = (flags[f] || 0) + 1;
console.log('flags', flags);
