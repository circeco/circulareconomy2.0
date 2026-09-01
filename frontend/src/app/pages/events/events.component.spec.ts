import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { EventsComponent } from './events.component';
import { EventsService, EventItem } from '../../services/events.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { AuthServiceStub, EventFavoritesServiceStub } from '../../testing/test-doubles';

function sampleEvent(overrides: Partial<EventItem> = {}): EventItem {
  const date = new Date(2026, 8, 15);
  return {
    id: 'e1',
    title: 'Repair cafe',
    description: 'desc',
    category: 'repair',
    location: 'Stockholm',
    website: '',
    time: '',
    image: '',
    date,
    dateStr: '15 Sep 2026',
    actionTags: ['repair'],
    sectorCategories: [],
    recurrenceLabel: '',
    ...overrides,
  };
}

describe('EventsComponent empty copy', () => {
  async function createComponent(opts?: {
    cityId?: string;
    events?: EventItem[];
    cities?: { id: string; name: string }[];
  }): Promise<{ fixture: ComponentFixture<EventsComponent>; component: EventsComponent }> {
    const cityId = opts?.cityId ?? 'stockholm';
    const cities = opts?.cities ?? [
      { id: 'stockholm', name: 'Stockholm' },
      { id: 'milan', name: 'Milan' },
    ];

    await TestBed.configureTestingModule({
      imports: [EventsComponent],
      providers: [
        provideRouter([]),
        { provide: EventsService, useValue: { events$: of(opts?.events ?? []) } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: AuthService, useClass: AuthServiceStub },
        { provide: EventFavoritesService, useClass: EventFavoritesServiceStub },
        {
          provide: CityContextService,
          useValue: { cityId$: of(cityId), cityId: signal(cityId) },
        },
        { provide: CitiesService, useValue: { cities$: of(cities) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventsComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  function emptyText(fixture: ComponentFixture<EventsComponent>): string {
    return (fixture.nativeElement.querySelector('.events-empty') as HTMLElement | null)?.textContent?.trim() ?? '';
  }

  it('names the selected city when there are no events and no date or action filter', async () => {
    const { fixture } = await createComponent({ cityId: 'stockholm' });
    expect(emptyText(fixture)).toBe('No upcoming circular events in Stockholm.');
  });

  it('uses the CitiesService display name for the selected cityId', async () => {
    const { fixture } = await createComponent({ cityId: 'milan' });
    expect(emptyText(fixture)).toBe('No upcoming circular events in Milan.');
  });

  it('keeps the filters sentence when a date is selected and nothing matches', async () => {
    const { fixture, component } = await createComponent({ cityId: 'stockholm' });
    component.onDatesChange([new Date(2026, 8, 15)]);
    fixture.detectChanges();
    expect(emptyText(fixture)).toBe('No events match the current filters.');
  });

  it('keeps the filters sentence when an action tag is narrowed and nothing matches', async () => {
    const { fixture, component } = await createComponent({ cityId: 'stockholm' });
    component.toggleActionTag('repair');
    fixture.detectChanges();
    expect(emptyText(fixture)).toBe('No events match the current filters.');
  });

  it('keeps the filters sentence when the city has events that the date filter excludes', async () => {
    const { fixture, component } = await createComponent({
      cityId: 'stockholm',
      events: [sampleEvent()],
    });
    expect(emptyText(fixture)).toBe('');
    component.onDatesChange([new Date(2026, 0, 1)]);
    fixture.detectChanges();
    expect(emptyText(fixture)).toBe('No events match the current filters.');
  });

  it('keeps the favourite empty sentence when the favourites filter is on', async () => {
    const { fixture, component } = await createComponent({
      cityId: 'stockholm',
      events: [sampleEvent()],
    });
    component.favoritesFilterActive.set(true);
    fixture.detectChanges();
    expect(emptyText(fixture)).toBe('No events saved as favourite');
  });
});
