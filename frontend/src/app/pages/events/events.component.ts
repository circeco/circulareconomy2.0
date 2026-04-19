import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventItem, EventsService } from '../../services/events.service';
import { SearchService } from '../../services/search.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { CalendarComponent } from '../../components/calendar/calendar.component';
import { ACTION_TAG_COLORS, ACTION_TAG_LABELS, ACTION_TAGS, SECTOR_CATEGORIES, SECTOR_CATEGORY_LABELS } from '../../data/taxonomy';

interface EventCategoryOption {
  id: string;
  label: string;
  emojiIcon: string;
  imageIcons: string[];
}

@Component({
  selector: 'events-page',
  standalone: true,
  imports: [CommonModule, CalendarComponent],
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.scss'],
})
export class EventsComponent {
  private destroyRef = inject(DestroyRef);
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;

  readonly actionTagIds = ACTION_TAGS.slice();
  readonly categories: EventCategoryOption[] = SECTOR_CATEGORIES.map((id) => ({
    id,
    label: SECTOR_CATEGORY_LABELS[id],
    emojiIcon: this.defaultCategoryEmoji(id),
    imageIcons: this.categoryImageIcons(id),
  }));
  selectedActionTags = signal<Set<string>>(new Set(ACTION_TAGS));
  selectedCategory = signal<string | null>(null);
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
    this.selectedCategory.set(this.selectedCategory() === id ? null : id);
  }

  toggleActionTag(tag: string): void {
    const next = new Set(this.selectedActionTags());
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    this.selectedActionTags.set(next);
  }

  isActionTagEnabled(tag: string): boolean {
    return this.selectedActionTags().has(tag);
  }

  actionTagLabel(tag: string): string {
    return ACTION_TAG_LABELS[tag as keyof typeof ACTION_TAG_LABELS] || tag;
  }

  actionTagColor(tag: string): string {
    return this.actionTagColors[tag] || '#45818e';
  }

  actionTagTextColor(tag: string): string {
    return tag === 'recycle' || tag === 'reduce' ? '#0c343d' : '#ffffff';
  }

  private defaultCategoryEmoji(id: string): string {
    const map: Record<string, string> = {
      apparel: '👕',
      'home-garden': '🏡',
      'cycling-sports': '🚲',
      electronics: '💻',
      'books-comics-magazines': '📚',
      music: '🎵',
    };
    return map[id] || '•';
  }

  private categoryImageIcons(id: string): string[] {
    if (id === 'apparel') {
      return [
        'assets/icons/clothing-shirt.png',
        'assets/icons/clothing-trainers.png',
      ];
    }
    if (id === 'electronics') {
      return [
        'assets/icons/electronics-devices.png',
        'assets/icons/electronics-fridge.png',
      ];
    }
    if (id === 'music') {
      return [
        'assets/icons/music-hdd.png',
        'assets/icons/electronics-headphones.png',
      ];
    }
    if (id === 'home-garden') {
      return [
        'assets/icons/furniture-lamp.png',
        'assets/icons/furniture-chair.png',
      ];
    }
    if (id === 'books-comics-magazines') {
      return [
        'assets/icons/books-open.png',
        'assets/icons/books-comics.png',
      ];
    }
    if (id === 'cycling-sports') {
      return [
        'assets/icons/sports-bicycle.png',
        'assets/icons/sports-basketball.png',
        'assets/icons/sports-barbell.png',
      ];
    }
    return [];
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
    const activeActionTags = this.selectedActionTags();
    const dateTimes = this.selectedDateTimes();
    const highlightEventId = this.selectedEventId();

    const filtered = this.events.filter((event) => {
      const matchSearch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.description.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query);

      const matchCategory = !category || event.sectorCategories.includes(category);
      const matchActionTag =
        activeActionTags.size === 0 ||
        event.actionTags.some((tag) => activeActionTags.has(tag));

      const eventDayStart = new Date(
        event.date.getFullYear(),
        event.date.getMonth(),
        event.date.getDate()
      ).getTime();
      const matchDate =
        dateTimes.size === 0 || dateTimes.has(eventDayStart);

      return matchSearch && matchCategory && matchActionTag && matchDate;
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
