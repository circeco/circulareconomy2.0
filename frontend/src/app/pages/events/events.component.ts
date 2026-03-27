import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EventsService,
  EventItem,
  EVENT_CATEGORIES,
} from '../../services/events.service';
import { SearchService } from '../../services/search.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { CalendarComponent } from '../../components/calendar/calendar.component';

@Component({
  selector: 'events-page',
  standalone: true,
  imports: [CommonModule, CalendarComponent],
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.scss'],
})
export class EventsComponent {
  private destroyRef = inject(DestroyRef);

  readonly categories = EVENT_CATEGORIES;
  selectedCategory = signal<string>('all');
  selectedDateTimes = signal<Set<number>>(new Set());
  selectedEventId = signal<string | null>(null);
  initialCalendarSelection: Date[] = [];
  initialCalendarViewDate: Date | null = null;

  events: EventItem[] = [];
  eventDatesForCalendar: Date[] = [];

  constructor(
    private eventsService: EventsService,
    public searchService: SearchService,
    public auth: AuthService,
    public eventFavorites: EventFavoritesService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    combineLatest([this.eventsService.events$, this.route.queryParams])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([events, params]) => {
        this.events = events;
        const dates = new Set<string>();
        events.forEach((e) => {
          const key = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate()).toISOString();
          dates.add(key);
        });
        this.eventDatesForCalendar = Array.from(dates).map((k) => new Date(k));

        const dateStr = params['date'];
        const eventId = params['event'];
        let dateToUse: Date | null = null;
        let hasExplicitDateFilter = false;
        if (dateStr && typeof dateStr === 'string') {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            dateToUse = d;
            hasExplicitDateFilter = true;
          }
        }
        if (eventId && typeof eventId === 'string') {
          this.selectedEventId.set(eventId);
          if (!dateToUse) {
            const ev = this.events.find((e) => e.id === eventId);
            if (ev) {
              dateToUse = ev.date;
              hasExplicitDateFilter = true;
            }
          }
        }
        if (hasExplicitDateFilter && dateToUse) {
          const dayStart = new Date(dateToUse.getFullYear(), dateToUse.getMonth(), dateToUse.getDate());
          this.selectedDateTimes.set(new Set([dayStart.getTime()]));
          this.initialCalendarSelection = [dayStart];
          this.initialCalendarViewDate = dayStart;
        } else {
          // Default state: no date selected -> show all events.
          this.selectedDateTimes.set(new Set());
          this.initialCalendarSelection = [];
          this.initialCalendarViewDate = null;
          if (!eventId) this.selectedEventId.set(null);
        }
      });
  }

  async toggleFavorite(eventId: string): Promise<void> {
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      this.auth.openModal();
      return;
    }
    this.eventFavorites.toggle(eventId);
  }

  selectCategory(id: string): void {
    this.selectedCategory.set(id);
  }

  onSearchInput(ev: Event): void {
    const value = (ev.target as HTMLInputElement)?.value ?? '';
    this.searchService.setQuery(value);
  }

  onDatesChange(dates: Date[]): void {
    this.selectedDateTimes.set(new Set(dates.map((d) => d.getTime())));
    if (dates.length === 0) {
      this.selectedEventId.set(null);
    }
  }

  filteredEvents = computed(() => {
    const query = this.searchService.query().toLowerCase();
    const category = this.selectedCategory();
    const dateTimes = this.selectedDateTimes();
    const highlightEventId = this.selectedEventId();

    const filtered = this.events.filter((event) => {
      const matchSearch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.description.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query);

      const matchCategory =
        category === 'all' || event.category === category;

      const eventDayStart = new Date(
        event.date.getFullYear(),
        event.date.getMonth(),
        event.date.getDate()
      ).getTime();
      const matchDate =
        dateTimes.size === 0 || dateTimes.has(eventDayStart);

      return matchSearch && matchCategory && matchDate;
    });

    if (highlightEventId) {
      const idx = filtered.findIndex((e) => e.id === highlightEventId);
      if (idx > 0) {
        const ev = filtered[idx];
        const rest = filtered.filter((_, i) => i !== idx);
        return [ev, ...rest];
      }
    }
    return filtered;
  });
}
