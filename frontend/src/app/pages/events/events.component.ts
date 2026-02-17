import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  EventsService,
  EventItem,
  EVENT_CATEGORIES,
} from '../../services/events.service';
import { SearchService } from '../../services/search.service';
import { CalendarComponent } from '../../components/calendar/calendar.component';

@Component({
  selector: 'events-page',
  standalone: true,
  imports: [CommonModule, CalendarComponent],
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.scss'],
})
export class EventsComponent {
  readonly categories = EVENT_CATEGORIES;
  selectedCategory = signal<string>('all');
  selectedDateTimes = signal<Set<number>>(new Set());

  events: EventItem[] = [];

  constructor(
    private eventsService: EventsService,
    public searchService: SearchService,
    private router: Router
  ) {
    this.events = this.eventsService.getEvents();
  }

  selectCategory(id: string): void {
    this.selectedCategory.set(id);
  }

  onDatesChange(dates: Date[]): void {
    this.selectedDateTimes.set(new Set(dates.map((d) => d.getTime())));
  }

  filteredEvents = computed(() => {
    const query = this.searchService.query().toLowerCase();
    const category = this.selectedCategory();
    const dateTimes = this.selectedDateTimes();

    return this.events.filter((event) => {
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
  });
}
