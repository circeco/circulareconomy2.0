import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { LandingComponent } from './landing.component';
import { EventsService } from '../../services/events.service';
import { FeaturedPlacesService } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { SearchService } from '../../services/search.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';

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
