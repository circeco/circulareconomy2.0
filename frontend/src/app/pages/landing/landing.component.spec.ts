import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { CLEAR_FOCUS_QUERY_PARAMS } from '../../utils/clear-focus-query-params';

import { LandingComponent } from './landing.component';
import { EventsService, EventItem } from '../../services/events.service';
import { FeaturedPlacesService, FeaturedPlace } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { SearchService } from '../../services/search.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { AuthServiceStub, EventFavoritesServiceStub } from '../../testing/test-doubles';

describe('LandingComponent', () => {
  let component: LandingComponent;
  let fixture: ComponentFixture<LandingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        { provide: EventsService, useValue: { events$: of([]) } },
        {
          provide: FeaturedPlacesService,
          useValue: {
            getAllPlaces: () => of([]),
          },
        },
        { provide: AuthService, useValue: { user$: of(null), openModal: () => {} } },
        { provide: EventFavoritesService, useValue: { toggle: () => {} } },
        { provide: SearchService, useValue: { query: signal(''), setQuery: () => {} } },
        {
          provide: CityContextService,
          useValue: {
            cityId: signal('stockholm'),
            cityId$: of('stockholm'),
            cityName: signal(''),
          },
        },
        {
          provide: CitiesService,
          useValue: {
            cities$: of([{ id: 'stockholm', name: 'Stockholm' }]),
            list: signal([{ id: 'stockholm', name: 'Stockholm' }]),
          },
        },
      ]
    })
    .overrideComponent(LandingComponent, {
      set: {
        template: '<div>landing-test</div>',
      },
    })
    .compileComponents();

    fixture = TestBed.createComponent(LandingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('names the selected city in the upcoming-events empty note', () => {
    expect(component.eventsLoaded).toBeTrue();
    expect(component.events.length).toBe(0);
    expect(component.cityName()).toBe('Stockholm');
  });

  it('drops place on View map and keeps it only for goToMapWithPlace', () => {
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);

    component.goToMapPage();
    expect(nav).toHaveBeenCalledWith(['/atlas'], {
      queryParams: CLEAR_FOCUS_QUERY_PARAMS,
      queryParamsHandling: 'merge',
    });

    component.goToEventsPage();
    expect(nav).toHaveBeenCalledWith(['/events'], {
      queryParams: CLEAR_FOCUS_QUERY_PARAMS,
      queryParamsHandling: 'merge',
    });

    component.goToMapWithPlace('four-vintage');
    expect(nav).toHaveBeenCalledWith(['/atlas'], {
      queryParams: { place: 'four-vintage', event: null },
      queryParamsHandling: 'merge',
    });
  });
});

describe('LandingComponent city name fallback', () => {
  async function createLanding(opts: {
    cityId?: string;
    cities?: { id: string; name: string }[];
    cachedCityName?: string;
  }): Promise<LandingComponent> {
    const cityId = opts.cityId ?? 'stockholm';
    const cities = opts.cities ?? [];

    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        { provide: EventsService, useValue: { events$: of([]) } },
        { provide: FeaturedPlacesService, useValue: { getAllPlaces: () => of([]) } },
        { provide: AuthService, useValue: { user$: of(null), openModal: () => {} } },
        { provide: EventFavoritesService, useValue: { toggle: () => {} } },
        { provide: SearchService, useValue: { query: signal(''), setQuery: () => {} } },
        {
          provide: CityContextService,
          useValue: {
            cityId: signal(cityId),
            cityId$: of(cityId),
            cityName: signal(opts.cachedCityName ?? ''),
          },
        },
        { provide: CitiesService, useValue: { cities$: of(cities), list: signal(cities) } },
      ],
    })
      .overrideComponent(LandingComponent, { set: { template: '<div>landing-test</div>' } })
      .compileComponents();

    const fixture = TestBed.createComponent(LandingComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('falls back to the cached cityContext name when the cities list is empty', async () => {
    const component = await createLanding({ cities: [], cachedCityName: 'Stockholm' });
    expect(component.cityName()).toBe('Stockholm');
  });

  it('formats cityId for display when the list and cached name are empty', async () => {
    const component = await createLanding({ cityId: 'stockholm', cities: [] });
    expect(component.cityName()).toBe('Stockholm');
  });
});

function sampleEvent(overrides: Partial<EventItem> = {}): EventItem {
  const date = overrides.date instanceof Date ? overrides.date : new Date(2026, 8, 12);
  return {
    id: 'e1',
    title: 'Loppis på Karlaplan',
    description: 'Second hand clothes accessories and home decore',
    category: 'reuse',
    location: 'Karlaplan, 114 60 Stockholm',
    website: 'https://www.stockholmsmarknader.se/',
    time: '11:00',
    image: '',
    date,
    dateStr: 'Sat 12 Sep 2026 · 11:00–15:00',
    actionTags: ['reuse'],
    sectorCategories: ['apparel'],
    recurrenceLabel: 'Every Saturday',
    ...overrides,
  };
}

function samplePlace(overrides: Partial<FeaturedPlace> = {}): FeaturedPlace {
  return {
    id: 'verdandi',
    name: 'Verdandi Second Hand',
    address: 'Fredsgatan 1 Sundbyberg',
    description: 'Second hand homeware, furniture and antiques.',
    storeType: 'reuse',
    label: 'Reuse',
    actionTags: ['reuse'],
    categories: ['home-garden'],
    web: 'https://www.verdandi.se/',
    coords: { lng: 18.0, lat: 59.3 },
    ...overrides,
  };
}

describe('LandingComponent phone home cards', () => {
  let fixture: ComponentFixture<LandingComponent>;

  beforeEach(async () => {
    document.documentElement.classList.add('layout-phone');
    document.body.classList.add('layout-phone');

    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        {
          provide: EventsService,
          useValue: {
            events$: of([
              sampleEvent({ id: 'e1', title: 'Loppis på Karlaplan', date: new Date(2026, 8, 12) }),
              sampleEvent({
                id: 'e2',
                title: 'Loppis på Lilla Essingen a much longer market title',
                date: new Date(2026, 8, 13),
                description: 'Buy and sell second hand clothes, accessories, toys',
              }),
              sampleEvent({ id: 'e3', title: 'Somo', date: new Date(2026, 8, 14) }),
            ]),
          },
        },
        {
          provide: FeaturedPlacesService,
          useValue: {
            getAllPlaces: () =>
              of([
                samplePlace({ id: 'verdandi', name: 'Verdandi Second Hand' }),
                samplePlace({
                  id: 'brocante',
                  name: 'Brocante Second hand',
                  address: 'Hornsgatan 73, 118 49 Stockholm',
                }),
              ]),
          },
        },
        { provide: AuthService, useClass: AuthServiceStub },
        { provide: EventFavoritesService, useClass: EventFavoritesServiceStub },
        { provide: SearchService, useValue: { query: signal(''), setQuery: () => {} } },
        {
          provide: CityContextService,
          useValue: {
            cityId: signal('stockholm'),
            cityId$: of('stockholm'),
            cityName: signal('Stockholm'),
          },
        },
        {
          provide: CitiesService,
          useValue: {
            cities$: of([{ id: 'stockholm', name: 'Stockholm' }]),
            list: signal([{ id: 'stockholm', name: 'Stockholm' }]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.width = '390px';
    host.style.maxWidth = '390px';
    host.style.display = 'block';
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.classList.remove('layout-phone');
    document.body.classList.remove('layout-phone');
    TestBed.resetTestingModule();
  });

  it('keeps upcoming event cards the same width in the phone carousel', () => {
    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.events-container > .event-card')
    ) as HTMLElement[];
    expect(cards.length).toBe(3);
    const widths = cards.map((card) => Math.round(card.getBoundingClientRect().width));
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths.every((w) => w === widths[0])).toBeTrue();
    expect(getComputedStyle(cards[0]).marginLeft).toBe(getComputedStyle(cards[1]).marginLeft);
  });

  it('makes the upcoming events row a bounded horizontal scroller', () => {
    const row = fixture.nativeElement.querySelector('.events-container') as HTMLElement;
    const styles = getComputedStyle(row);
    expect(styles.display).toBe('flex');
    expect(styles.overflowX).toBe('auto');
    expect(styles.minWidth).toBe('0px');
    expect(row.clientWidth).toBeGreaterThan(0);
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
  });

  it('keeps place-card border and shadow when the heart is favourited and focused', () => {
    const card = fixture.nativeElement.querySelector(
      '.places-container > .event-card'
    ) as HTMLElement;
    const heart = card.querySelector('.heart-btn') as HTMLButtonElement;
    expect(card).toBeTruthy();
    expect(heart).toBeTruthy();

    const restShadow = getComputedStyle(card).boxShadow;
    const restBorder = parseFloat(getComputedStyle(card).borderTopWidth);
    expect(restShadow).not.toBe('none');
    expect(restBorder).toBeGreaterThan(0);

    heart.setAttribute('aria-pressed', 'true');
    heart.textContent = '♥';
    card.focus();
    fixture.detectChanges();

    const favStyles = getComputedStyle(card);
    expect(favStyles.boxShadow).not.toBe('none');
    expect(parseFloat(favStyles.borderTopWidth)).toBeGreaterThan(0);
    expect(favStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});
