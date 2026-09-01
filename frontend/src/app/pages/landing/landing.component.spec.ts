import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { LandingComponent } from './landing.component';
import { EventsService } from '../../services/events.service';
import { FeaturedPlacesService } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { FavoritesService } from '../../services/favorites.service';
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
            getFeaturedPlaces: () => of([]),
            getAllPlaces: () => of([]),
          },
        },
        { provide: AuthService, useValue: { user$: of(null), openModal: () => {} } },
        { provide: EventFavoritesService, useValue: { toggle: () => {}, isFavorite: () => false } },
        { provide: FavoritesService, useValue: {} },
        { provide: SearchService, useValue: { query: signal(''), setQuery: () => {} } },
        { provide: CityContextService, useValue: { cityId: signal('stockholm'), cityId$: of('stockholm') } },
        { provide: CitiesService, useValue: { cities$: of([{ id: 'stockholm', name: 'Stockholm' }]) } },
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
    expect(component.eventsReady).toBeTrue();
    expect(component.events.length).toBe(0);
    expect(component.upcomingEventsEmptyMessage()).toBe('No upcoming circular events for Stockholm.');

    component.selectedCityName = 'Milan';
    expect(component.upcomingEventsEmptyMessage()).toBe('No upcoming circular events for Milan.');

    component.selectedCityName = 'Turin';
    expect(component.upcomingEventsEmptyMessage()).toBe('No upcoming circular events for Turin.');

    component.selectedCityName = 'Uppsala';
    expect(component.upcomingEventsEmptyMessage()).toBe('No upcoming circular events for Uppsala.');
  });
});
