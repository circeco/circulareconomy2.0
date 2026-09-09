/* eslint-disable no-console */
/**
 * Manually enqueue curated event candidates into Firestore `reviewQueue`
 * (same document shape as `discover-events-agent.js`).
 *
 * Usage:
 *   node tools/enqueue-event-candidates.js --dry-run
 *   node tools/enqueue-event-candidates.js
 */
const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  hashString,
  hostFromUrl,
  eventDedupeKey,
  isCircularEventCandidate,
  inferActionTags,
  circularKeywordsFromCity,
  confidenceForEvent,
  createEventMemoryLookup,
  matchEventGeography,
} = require('./lib/event-discovery-common');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';

const CANDIDATES = [
  {
    cityId: 'milan',
    title: 'Wunder Mrkt – il mercato nell’ex fabbrica di profumi',
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    locationName: 'Spazio Profumo',
    locationText: 'Spazio Profumo, Via Ambrogio Binda 29, Milano',
    address: 'Via Ambrogio Binda 29, Milano',
    website: 'https://wundermrkt.com/tutti-gli-eventi/',
    timeDisplay: '11:00–20:30',
    description:
      'Domenica 4 ottobre 2026 il market inaugura la nuova casa a Spazio Profumo a Milano. Vintage, design indipendente, artigianato e shopping sostenibile. Da ottobre torna ogni prima domenica del mese.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'monthly_nth', windowMonths: 6 },
    sourceUrl: 'https://wundermrkt.com/tutti-gli-eventi/',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Santeria',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    locationName: 'Santeria',
    locationText: 'Santeria, Milano',
    address: 'Santeria, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market vintage e second hand a Santeria, Milano. Espositori sold out — lista d’attesa sul sito.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Mercato Isola',
    startDate: '2026-10-03',
    endDate: '2026-10-03',
    locationName: 'Mercato Isola',
    locationText: 'Piazzale Lagosta 7, Milano',
    address: 'Piazzale Lagosta 7, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market al Mercato Isola: vintage, second hand, pezzi unici e food court nel quartiere Isola.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Mercato Isola',
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    locationName: 'Mercato Isola',
    locationText: 'Piazzale Lagosta 7, Milano',
    address: 'Piazzale Lagosta 7, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market al Mercato Isola: vintage, second hand, pezzi unici e food court nel quartiere Isola.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Teatro Cinema Martinitt',
    startDate: '2026-10-18',
    endDate: '2026-10-18',
    locationName: 'Teatro Cinema Martinitt',
    locationText: 'Via Pitteri 58, Milano',
    address: 'Via Pitteri 58, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market nel cortile del Teatro Martinitt: vintage, second hand e pezzi unici, con musica e dj set.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  // From https://www.vibeevents.it/mercatini-milano/ — skip Remira 20 Sep (already queued).
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Vecchi Libri in Piazza',
      locationName: 'Duomo / Centro Storico',
      locationText: 'Via Mercanti / Duomo, Milano',
      address: 'Via Mercanti, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Mercatino di libri usati all’aperto in centro a Milano. Ingresso libero.',
      actionTags: ['reuse'],
      sectorCategories: ['books-comics-magazines'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-13', '2026-10-11', '2026-11-08', '2026-12-13']
  ),
  {
    cityId: 'milan',
    title: 'East Market',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    locationName: 'East End Studios',
    locationText: 'Via Mecenate 88/A, Milano',
    address: 'Via Mecenate 88/A, Milano',
    website: 'https://eastmarketmilano.com/',
    timeDisplay: '10:00–21:00',
    description:
      'Vintage, second hand, modernariato, vinili e pezzi unici in ex fabbrica aeronautica. Ingresso a pagamento; bambini fino a 12 anni gratis.',
    actionTags: ['reuse'],
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Mercatino di Brera',
      locationName: 'Brera',
      locationText: 'Via Fiori Chiari / Brera, Milano',
      address: 'Via Fiori Chiari, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Mercatino all’aperto in Brera: antiquariato, vintage e modernariato. Ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-20', '2026-10-18', '2026-11-15', '2026-12-20']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Mercatone dell’Antiquariato sui Navigli',
      locationName: 'Navigli',
      locationText: 'Alzaia Naviglio Grande, Milano',
      address: 'Alzaia Naviglio Grande, Milano',
      website: 'https://www.milanofree.it/milano/eventi/mercatone-dellantiquariato-sui-navigli-calendario-2026-orari-e-come-arrivare.html',
      description:
        'Mercatone dell’antiquariato e modernariato lungo i Navigli. Ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-27', '2026-10-25', '2026-11-29', '2026-12-20']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Fair Priced Vintage',
      locationName: 'Department 184',
      locationText: 'Department 184, Via Varesina 184, Milano',
      address: 'Via Varesina 184, Milano',
      website: 'https://www.dept184.com/events/fair-priced-vintage-2',
      description:
        'Vintage clothing market a prezzi fissi al Department 184 (Certosa). Ingresso libero con registrazione. Riuso e moda circolare.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-10-02', '2026-10-03', '2026-10-04']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'AMART – Antiquariato a Milano',
      locationName: 'Brera / Montenapoleone',
      locationText: 'Brera / Montenapoleone, Milano',
      address: 'Brera, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Fiera di antiquariato, vintage e modernariato in zona Brera. Ingresso a pagamento.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Cotoletta Vintage Market',
      locationName: 'Department 184',
      locationText: 'Department 184, Via Varesina 184, Milano',
      address: 'Via Varesina 184, Milano',
      website: 'https://www.cotolettavintagemarket.it/',
      timeDisplay: '10:00–20:00',
      description:
        'Market di modernariato, vintage, toys e vinili al Department 184. Oltre 50 espositori, ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-11-28', '2026-11-29']
  ),
  {
    cityId: 'milan',
    title: 'Fiera di Sinigaglia',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Darsena / Navigli',
    locationText: 'Via Valenza, Darsena, Milano',
    address: 'Via Valenza, Milano',
    website: 'https://www.vibeevents.it/mercatini-milano/',
    description:
      'Storico mercatino dell’usato alla Darsena, ogni sabato fino al 26 dicembre 2026. Ingresso libero.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'weekly', until: '2026-12-26', windowMonths: 4 },
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
  {
    cityId: 'milan',
    title: 'Maramao Vintage Market',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Tempio del Futuro Perduto',
    locationText: 'Tempio del Futuro Perduto, Via Luigi Nono 9, Milano',
    address: 'Via Luigi Nono 9, Milano',
    website: 'https://www.tempiodelfuturo.art/',
    timeDisplay: '11:00–19:00',
    description:
      'Vintage, second hand, artigianato e vinili ogni sabato al Tempio del Futuro Perduto (Sempione), fino al 19 dicembre 2026. Ingresso libero.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'weekly', until: '2026-12-19', windowMonths: 4 },
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
  // From https://loppiskartan.se/loppiskalender — Stockholms län only.
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Hågelby Bakluckeloppis',
      locationName: 'Hågelbyparken',
      locationText: 'Hågelby Gård, 147 43 Tumba, Botkyrka',
      address: 'Hågelby Gård, 147 43 Tumba, Botkyrka',
      website: 'https://botkyrkaloppis.se/',
      timeDisplay: '11:00–15:00',
      description:
        'Söderorts största bakluckeloppis i Hågelbyparken, Tumba. Flera hundra säljare säljer ur bilen. Fri entré och parkering för besökare. Säljplats bokas på botkyrkaloppis.se.',
      actionTags: ['reuse'],
      sourceUrl: 'https://loppiskartan.se/markets/hagelby-bakluckeloppis',
    },
    ['2026-09-12', '2026-09-26', '2026-10-03', '2026-10-10']
  ),
  {
    cityId: 'stockholm',
    title: 'Loppis/hantverksmässa',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Norrtälje',
    locationText: 'Galles gränd 5, 761 30 Norrtälje',
    address: 'Galles gränd 5, 761 30 Norrtälje',
    website: 'https://www.facebook.com/events/990902443932682',
    timeDisplay: '11:00–15:00',
    description:
      'Loppis och hantverksmässa i Norrtälje. Tider ungefärliga — se Facebook-eventet för aktuella tider.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/loppis-hantverksmassa',
  },
  {
    cityId: 'stockholm',
    title: 'Mimer Loppmarknad Odenplan',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Odenplan / Vasastan',
    locationText: 'Norrtullsgatan 10, 113 27 Stockholm',
    address: 'Norrtullsgatan 10, 113 27 Stockholm',
    website: 'https://loppiskartan.se/markets/mimer-loppmarknad-odenplan',
    timeDisplay: '10:00–14:00',
    description:
      'Inomhusloppmarknad nära Odenplan i Vasastan, Stockholm. Fri entré. Tider ungefärliga enligt Loppiskartan.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/mimer-loppmarknad-odenplan',
  },
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Bakluckeloppis på Roslagsstoppet',
      locationName: 'Roslagsstoppet',
      locationText: 'Roslagsstoppet, Söderhall, 186 96 Vallentuna',
      address: 'Roslagsstoppet, Söderhall, 186 96 Vallentuna',
      website: 'https://roslagsloppis.se/',
      timeDisplay: '11:00–15:00',
      description:
        'Bakluckeloppis på Roslagsstoppet vid E18, Söderhall (Vallentuna), ca 20 min från Stockholm. Söndagar 11–15 under säsongen. Fri entré. Säljplats bokas på roslagsloppis.se.',
      actionTags: ['reuse'],
      sourceUrl: 'https://loppiskartan.se/markets/bakluckeloppis-pa-roslagsstoppet',
    },
    ['2026-09-13', '2026-09-20', '2026-09-27']
  ),
  {
    cityId: 'stockholm',
    title: 'Loppis i Enskedeparken',
    startDate: '2026-09-13',
    endDate: '2026-09-13',
    locationName: 'Enskedeparken',
    locationText: 'Enskede IK, Trädskolevägen 60, 120 48 Stockholm',
    address: 'Trädskolevägen 60, 120 48 Stockholm',
    website: 'https://www.facebook.com/events/1508153333836936',
    timeDisplay: '10:00–14:00',
    description:
      'Utomhusloppis i Enskedeparken vid Enskede IK. Fri entré. Tider ungefärliga — se Facebook-eventet för aktuella tider.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/loppis-i-enskedeparken',
  },
  {
    cityId: 'stockholm',
    title: 'Oppundaparkens loppis i Svedmyra',
    startDate: '2026-09-13',
    endDate: '2026-09-13',
    locationName: 'Oppundaparken',
    locationText: 'Oppundavägen 23, 122 48 Enskede, Stockholm',
    address: 'Oppundavägen 23, 122 48 Enskede',
    website: 'https://www.facebook.com/events/1547444890116040',
    timeDisplay: '10:00–14:00',
    description:
      'Loppis i Oppundaparken, Svedmyra. Fri entré. Tider ungefärliga — se Facebook-eventet för aktuella tider.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/oppundaparkens-loppis-i-svedmyra',
  },
  {
    cityId: 'stockholm',
    title: 'Promenadloppis på Stora Essingen',
    startDate: '2026-09-13',
    endDate: '2026-09-13',
    locationName: 'Stora Essingen',
    locationText: 'Stora Essingen, Stockholm',
    address: 'Stora Essingen, Stockholm',
    website: 'https://essingedagarna.se',
    timeDisplay: '11:00–16:00',
    description:
      'Promenadloppis runt Stora Essingen under Essingedagarna: kläder, inredning, leksaker, böcker och unika fynd vid adresser runt ön (bl.a. Badstrandsvägen, Essingestråket, Vängåvans parklek). Fri entré.',
    actionTags: ['reuse'],
    sectorCategories: ['apparel', 'home-garden', 'books-comics-magazines'],
    sourceUrl: 'https://loppiskartan.se/markets/promenadloppis-pa-stora-essingen',
  },
  {
    cityId: 'stockholm',
    title: 'Loppis på Lilla Essingen',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Lilla Essingen / ICA Nära',
    locationText: 'Disponentgatan 6, Lilla Essingen, Stockholm',
    address: 'Disponentgatan 6, Lilla Essingen, Stockholm',
    website: 'https://essingedagarna.se',
    timeDisplay: '10:00–15:00',
    description:
      'Höstmarknad och loppis på Lilla Essingen under Essingedagarna, utanför ICA Nära (Disponentgatan 6). Lördag 12 september 10–15. Anmälan till loppisen: vivecaberg@gmail.com. Fri entré.',
    actionTags: ['reuse'],
    sourceUrl: 'https://essingedagarna.se',
  },
  {
    cityId: 'stockholm',
    title: 'Stureby Loppisdag 2026',
    startDate: '2026-09-13',
    endDate: '2026-09-13',
    locationName: 'Stureby',
    locationText: 'Stureby, Stockholm',
    address: 'Stureby, Stockholm',
    website: 'https://www.facebook.com/events/1629629548290188',
    timeDisplay: '10:00–14:00',
    description:
      'Loppisdag i Stureby, södra Stockholm. Fri entré. Tider ungefärliga — se Facebook-eventet för aktuella tider och gatuadresser.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/stureby-loppisdag-2026',
  },
  {
    cityId: 'stockholm',
    title: 'MHS Bakluckeloppis Täby',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    locationName: 'Arninge / Täby',
    locationText: 'Polygonvägen 19, 187 66 Arninge, Täby',
    address: 'Polygonvägen 19, 187 66 Arninge',
    website: 'https://loppiskartan.se/markets/mhs-bakluckeloppis-taby',
    timeDisplay: '10:00–14:00',
    description:
      'MHS bakluckeloppis i Arninge, Täby. Fri entré. Tider ungefärliga enligt Loppiskartan.',
    actionTags: ['reuse'],
    sourceUrl: 'https://loppiskartan.se/markets/mhs-bakluckeloppis-taby',
  },
  {
    cityId: 'stockholm',
    title: 'Barnloppis i Kista',
    startDate: '2026-09-26',
    endDate: '2026-09-26',
    locationName: 'Kista',
    locationText: 'Torshamnsgatan 18, 164 40 Stockholm',
    address: 'Torshamnsgatan 18, 164 40 Stockholm',
    website: 'https://www.facebook.com/events/1707295843583294',
    timeDisplay: '10:00–14:00',
    description:
      'Barnloppis i Kista. Second hand för barnkläder och barnprylar. Fri entré. Tider ungefärliga — se Facebook-eventet för aktuella tider.',
    actionTags: ['reuse'],
    sectorCategories: ['apparel'],
    sourceUrl: 'https://loppiskartan.se/markets/barnloppis-i-kista',
  },
  // Karlaplan Saturdays from organiser + Tickster datepicker
  // https://secure.tickster.com/sv/1yf0aurjcd4kpyz/selectevent
  // https://stockholmsmarknader.se/karlaplan/ — 11 Apr–14 Nov 2026, not 20 Jun.
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Loppis på Karlaplan',
      locationName: 'Karlaplan',
      locationText: 'Karlaplan, 114 60 Stockholm',
      address: 'Karlaplan, 114 60 Stockholm',
      website: 'https://stockholmsmarknader.se/karlaplan/',
      timeDisplay: '11:00–15:00',
      description:
        'Lördagsloppis runt fontänen på Karlaplan, Östermalm. Öppet lördagar kl. 11–15, 11 april–14 november 2026 (utom midsommardagen 20 juni). Fri entré. Arrangör Stockholmsmarknader. Säljarplats bokas på Tickster.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel', 'home-garden'],
      recurrence: { frequency: 'weekly', until: '2026-11-14', windowMonths: 3 },
      sourceUrl: 'https://secure.tickster.com/sv/1yf0aurjcd4kpyz/selectevent',
    },
    [
      '2026-09-12',
      '2026-09-19',
      '2026-09-26',
      '2026-10-03',
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
      '2026-10-31',
      '2026-11-07',
      '2026-11-14',
    ]
  ),
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Loppis på Mariatorget',
      locationName: 'Mariatorget',
      locationText: 'Mariatorget, 118 49 Stockholm',
      address: 'Mariatorget, 118 49 Stockholm',
      website: 'https://stockholmsmarknader.se/mariatorget/',
      timeDisplay: '11:00–15:00',
      description:
        'Söndagsloppis på Mariatorget, Södermalm. Öppet söndagar kl. 11–15, 3 maj–27 september 2026 (stängt midsommardagen 21 juni). Fri entré. Arrangör Stockholmsmarknader.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel', 'home-garden'],
      recurrence: { frequency: 'weekly', until: '2026-09-27', windowMonths: 1 },
      sourceUrl: 'https://stockholmsmarknader.se/mariatorget/',
    },
    ['2026-09-13', '2026-09-20', '2026-09-27']
  ),
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Hötorgets söndagsloppis',
      locationName: 'Hötorget',
      locationText: 'Hötorget, 111 57 Stockholm',
      address: 'Hötorget, 111 57 Stockholm',
      website: 'https://stockholmsmarknader.se/hotorget/',
      timeDisplay: '10:00–16:00',
      description:
        'Söndagsloppis mitt på Hötorget. Öppet alla söndagar kl. 10–16 året runt 2026. Fri entré. Arrangör Stockholmsmarknader.',
      actionTags: ['reuse'],
      sectorCategories: ['home-garden', 'books-comics-magazines'],
      recurrence: { frequency: 'weekly', until: '2026-12-27', windowMonths: 4 },
      sourceUrl: 'https://stockholmsmarknader.se/hotorget/',
    },
    [
      '2026-09-13',
      '2026-09-20',
      '2026-09-27',
      '2026-10-04',
      '2026-10-11',
      '2026-10-18',
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
      '2026-12-06',
      '2026-12-13',
      '2026-12-20',
      '2026-12-27',
    ]
  ),
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Loppmarknaden i Vårberg',
      locationName: 'Vårberg',
      locationText: 'Fjärdholmsgränd 4, 127 48 Skärholmen',
      address: 'Fjärdholmsgränd 4, 127 48 Skärholmen',
      website: 'https://loppmarknaden.se/',
      timeDisplay: '10:30–18:00',
      description:
        'Inomhusloppis i Vårberg vid Skärholmen. Second hand: möbler, kläder, porslin, skivor och husgeråd; man kan också hyra bord. Öppet alla dagar året runt: mån–fre 10:30–18:00, lör–sön 10:30–17:00. Fri entré.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel', 'home-garden'],
      sourceUrl: 'https://loppiskartan.se/markets/loppmarknaden-i-varberg',
    },
    weekdays('2026-09-10', '2026-12-31')
  ),
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Loppmarknaden i Vårberg',
      locationName: 'Vårberg',
      locationText: 'Fjärdholmsgränd 4, 127 48 Skärholmen',
      address: 'Fjärdholmsgränd 4, 127 48 Skärholmen',
      website: 'https://loppmarknaden.se/',
      timeDisplay: '10:30–17:00',
      description:
        'Inomhusloppis i Vårberg vid Skärholmen. Second hand: möbler, kläder, porslin, skivor och husgeråd; man kan också hyra bord. Öppet alla dagar året runt: mån–fre 10:30–18:00, lör–sön 10:30–17:00. Fri entré.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel', 'home-garden'],
      sourceUrl: 'https://loppiskartan.se/markets/loppmarknaden-i-varberg',
    },
    weekends('2026-09-10', '2026-12-31')
  ),
  ...expandDates(
    {
      cityId: 'stockholm',
      title: 'Låt oss lappa, stoppa och laga!',
      locationName: 'Knuten / Midsommargården',
      locationText: 'Knuten, Trettondagsvägen 12, Telefonplan, 126 37 Hägersten, Stockholm',
      address: 'Trettondagsvägen 12, 126 37 Hägersten, Stockholm',
      website: 'https://midsommar.memlist.se/ev/121',
      timeDisplay: '13:00–15:00',
      description:
        'Gratis studiecirkel för att laga och förlänga livet på kläder och textilier. Ledd av Maria Hellvig i samarbete med ABF. Inga förkunskaper krävs; symaskin, tråd och enklare material finns på plats. Anmälan krävs. Plats: Knuten (Midsommargårdens bakficka), bakom ABCafé på Trettondagsvägen 12, Telefonplan.',
      actionTags: ['repair', 'reuse'],
      sectorCategories: ['apparel'],
      sourceUrl: 'https://stayhappening.com/e/l%C3%A5t-oss-lappa-stoppa-och-laga-E2ISYP28AF2',
    },
    ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17', '2026-12-01']
  ),
];

function expandDates(base, dates) {
  return dates.map((startDate) => ({
    ...base,
    startDate,
    endDate: startDate,
  }));
}

function eachDay(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function weekdays(from, to) {
  return eachDay(from, to).filter((iso) => {
    const dow = new Date(`${iso}T12:00:00`).getDay();
    return dow !== 0 && dow !== 6;
  });
}

function weekends(from, to) {
  return eachDay(from, to).filter((iso) => {
    const dow = new Date(`${iso}T12:00:00`).getDay();
    return dow === 0 || dow === 6;
  });
}

function initAdminApp() {
  if (getApps().length > 0) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: PROJECT_ID });
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  const defaultCredPath = path.join(repoRoot, 'secrets', 'firebase-adminsdk.json');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultCredPath;
  if (!existsSync(credPath)) {
    console.error('[enqueue-events] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

async function loadApprovedEventKeys(db, cityId) {
  const snap = await db.collection('events').where('cityId', '==', cityId).where('status', '==', 'approved').get();
  const keys = new Set();
  for (const d of snap.docs) {
    const row = d.data() || {};
    const title = String(row.title || '').trim();
    const startDate = String(row.startDate || '').trim();
    const locationText = String(row.locationText || row.address || '').trim();
    if (!startDate || !title) continue;
    keys.add(eventDedupeKey(cityId, title, startDate, locationText));
  }
  return keys;
}

async function loadReviewedQueueEventIds(db, cityId) {
  const reviewedStates = ['approved', 'rejected', 'edited', 'superseded'];
  const snap = await db
    .collection('reviewQueue')
    .where('cityId', '==', cityId)
    .where('kind', '==', 'event')
    .where('status', 'in', reviewedStates)
    .get();
  return new Set(snap.docs.map((d) => d.id));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  initAdminApp();
  const db = getFirestore();

  const byCity = new Map();
  for (const raw of CANDIDATES) {
    const list = byCity.get(raw.cityId) || [];
    list.push(raw);
    byCity.set(raw.cityId, list);
  }

  let written = 0;
  let skipped = 0;

  for (const [cityId, rows] of byCity) {
    const citySnap = await db.collection('cities').doc(cityId).get();
    const cityDoc = citySnap.exists ? citySnap.data() || {} : {};
    const keywords = circularKeywordsFromCity(cityDoc, cityId);
    const reviewedQueueIds = await loadReviewedQueueEventIds(db, cityId);
    const approvedKeys = await loadApprovedEventKeys(db, cityId);
    const memoryLookup = await createEventMemoryLookup(db, cityId);
    const runSeenKeys = new Set();

    for (const raw of rows) {
      const geo = matchEventGeography(cityId, raw);
      if (!geo.ok) {
        console.log(`  skip wrong-city ${raw.title} @ ${raw.startDate} (${geo.matched})`);
        skipped += 1;
        continue;
      }

      const circular = isCircularEventCandidate(raw.title, raw.description, keywords);
      if (!circular.ok) {
        console.log(`  skip non-circular ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const actionTags = inferActionTags(raw.title, raw.description, raw.actionTags || circular.matchedActionTags);
      const key = eventDedupeKey(cityId, raw.title, raw.startDate, raw.locationText);
      if (approvedKeys.has(key) || runSeenKeys.has(key)) {
        console.log(`  skip duplicate ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const stableKey = `website|${raw.sourceUrl}|${raw.title}|${raw.startDate}|${raw.locationText}`;
      const docId = `event_${cityId}_${hashString(stableKey)}`;
      if (reviewedQueueIds.has(docId)) {
        console.log(`  skip reviewed ${docId}`);
        skipped += 1;
        continue;
      }

      const existing = await db.collection('reviewQueue').doc(docId).get();
      if (existing.exists && String(existing.data()?.status || '') === 'needs_review') {
        console.log(`  skip already queued ${docId} ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const candidate = {
        title: raw.title,
        startDate: raw.startDate,
        endDate: raw.endDate || raw.startDate,
        locationText: raw.locationText,
        address: raw.address || raw.locationText,
        locationName: raw.locationName || '',
        website: raw.website,
        description: String(raw.description || '').slice(0, 2000),
        timeDisplay: raw.timeDisplay || '',
        actionTags,
        sectorCategories: raw.sectorCategories || [],
        source: 'web_agent',
        sourceHost: hostFromUrl(raw.website || raw.sourceUrl),
      };
      if (raw.recurrence) candidate.recurrence = raw.recurrence;

      const memorySignal = await memoryLookup.assess(candidate);
      if (memorySignal.hardDuplicate) {
        console.log(`  skip memory ${raw.title} @ ${raw.startDate} (${memorySignal.reasons.join(',')})`);
        skipped += 1;
        continue;
      }

      let confidence = confidenceForEvent(candidate, circular.matchedKeywords.length, memorySignal.boost || 0);
      if (circular.via === 'title') confidence = Math.min(0.95, confidence + 0.06);

      const payload = {
        kind: 'event',
        cityId,
        status: 'needs_review',
        confidence,
        candidate,
        evidence: [
          {
            url: raw.sourceUrl || raw.website,
            snippet: `curated seed; circular=${circular.matchedKeywords.slice(0, 3).join(',')}; via=${circular.via}; geo=${geo.reason}${
              geo.matched ? `:${geo.matched}` : ''
            }; actions=${actionTags.join(',')}`,
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: [],
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      };

      console.log(`  ${dryRun ? '[dry-run] ' : ''}${docId} ${candidate.title} @ ${candidate.startDate} (${confidence.toFixed(2)})`);
      if (!dryRun) {
        await db.collection('reviewQueue').doc(docId).set(payload, { merge: true });
        written += 1;
      }
      runSeenKeys.add(key);
    }
  }

  console.log(`[enqueue-events] ${dryRun ? 'dry-run' : 'committed'} written=${written} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('[enqueue-events] failed', err);
  process.exitCode = 1;
});
