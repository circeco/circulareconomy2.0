import { Component, DestroyRef, inject, signal, computed, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventItem, EventsService } from '../../services/events.service';
import { SearchService } from '../../services/search.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { PhoneChromeService } from '../../services/phone-chrome.service';
import { CalendarComponent } from '../../components/calendar/calendar.component';
import {
  ACTION_TAG_COLORS,
  ACTION_TAG_LABELS,
  ACTION_TAGS,
  SECTOR_CATEGORIES,
  SECTOR_CATEGORY_LABELS,
  canonicalizeSectorCategories,
} from '../../data/taxonomy';

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
export class EventsComponent implements AfterViewChecked {
  private destroyRef = inject(DestroyRef);
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;
  private lastClampMeasureKey = '';

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
  favoritesFilterActive = signal(false);
  expandedDescriptions = signal<Set<string>>(new Set());
  /** Event ids whose description is actually clamped (overflowing). */
  clampedDescriptionIds = signal<Set<string>>(new Set());
  initialCalendarSelection: Date[] = [];
  initialCalendarViewDate: Date | null = null;

  events = signal<EventItem[]>([]);
  eventDatesForCalendar: Date[] = [];
  readonly cityName = signal('');

  readonly favoriteEventDatesForCalendar = computed(() => {
    const favoriteIds = this.eventFavorites.favoriteIds();
    const dates = new Set<string>();
    for (const e of this.events()) {
      if (!favoriteIds.has(e.id)) continue;
      const key = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate()).toISOString();
      dates.add(key);
    }
    return Array.from(dates).map((k) => new Date(k));
  });

  constructor(
    private eventsService: EventsService,
    public searchService: SearchService,
    public auth: AuthService,
    public eventFavorites: EventFavoritesService,
    private cityContext: CityContextService,
    private cities: CitiesService,
    private chrome: PhoneChromeService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    combineLatest([this.cityContext.cityId$, this.cities.cities$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([cityId, cities]) => {
        this.cityName.set(cities.find((c) => c.id === cityId)?.name || '');
      });

    combineLatest([this.eventsService.events$, this.route.queryParams])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([events, params]) => {
        this.events.set(events);
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
            const ev = this.events().find((e) => e.id === eventId);
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

    this.auth.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user) {
          this.favoritesFilterActive.set(false);
          this.chrome.eventsFavoritesOn.set(false);
        }
      });

    this.chrome.eventsSavedToggle$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.toggleFavoritesFilter();
      });
  }

  async toggleFavoritesFilter(): Promise<void> {
    if (this.favoritesFilterActive()) {
      this.favoritesFilterActive.set(false);
      this.chrome.eventsFavoritesOn.set(false);
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      this.auth.openModal();
      return;
    }
    this.favoritesFilterActive.set(true);
    this.chrome.eventsFavoritesOn.set(true);
  }

  async toggleFavorite(eventId: string): Promise<void> {
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      this.auth.openModal();
      return;
    }
    await this.eventFavorites.toggle(eventId);
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

  sectorIconsFor(sectors: string[] | undefined): string[] {
    const ids = canonicalizeSectorCategories(sectors || []);
    const out: string[] = [];
    for (const id of ids) {
      for (const path of this.categoryImageIcons(id)) {
        if (!out.includes(path)) out.push(path);
      }
    }
    return out;
  }

  sectorLabelForIcon(iconPath: string): string {
    for (const id of SECTOR_CATEGORIES) {
      if (this.categoryImageIcons(id).includes(iconPath)) {
        return SECTOR_CATEGORY_LABELS[id];
      }
    }
    return '';
  }

  /** Short label for cards: `www.host.it/` — href stays the full URL. */
  websiteDisplayLabel(url: string | undefined | null): string {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      let host = parsed.hostname.toLowerCase();
      if (!host.startsWith('www.')) host = `www.${host}`;
      return `${host}/`;
    } catch {
      const host = raw
        .replace(/^https?:\/\//i, '')
        .replace(/^\/\//, '')
        .split('/')[0]
        .split('?')[0]
        .split('#')[0]
        .toLowerCase();
      if (!host) return raw;
      return `${host.startsWith('www.') ? host : `www.${host}`}/`;
    }
  }

  isDescriptionExpanded(eventId: string): boolean {
    return this.expandedDescriptions().has(eventId);
  }

  descriptionNeedsMore(eventId: string, _description: string): boolean {
    if (this.isDescriptionExpanded(eventId)) return true;
    return this.clampedDescriptionIds().has(eventId);
  }

  toggleDescription(eventId: string): void {
    const next = new Set(this.expandedDescriptions());
    if (next.has(eventId)) next.delete(eventId);
    else next.add(eventId);
    this.expandedDescriptions.set(next);
    this.lastClampMeasureKey = '';
  }

  ngAfterViewChecked(): void {
    const key = `${this.filteredEvents()
      .map((e) => e.id)
      .join('|')}#${[...this.expandedDescriptions()].sort().join(',')}`;
    if (key === this.lastClampMeasureKey) return;
    this.lastClampMeasureKey = key;
    queueMicrotask(() => this.measureClampedDescriptions());
  }

  private measureClampedDescriptions(): void {
    const nodes = document.querySelectorAll<HTMLElement>(
      '.event-card .event-description-block:not(.expanded) .event-description'
    );
    const next = new Set<string>();
    nodes.forEach((el) => {
      const id = el.closest('.event-card')?.getAttribute('data-event-id');
      if (!id) return;
      if (el.scrollHeight > el.clientHeight + 1) next.add(id);
    });
    const prev = this.clampedDescriptionIds();
    if (prev.size !== next.size || [...next].some((id) => !prev.has(id))) {
      this.clampedDescriptionIds.set(next);
    }
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
    const favoritesOnly = this.favoritesFilterActive();
    const favoriteIds = this.eventFavorites.favoriteIds();

    const filtered = this.events().filter((event) => {
      const matchSearch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.description.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query) ||
        event.website.toLowerCase().includes(query) ||
        event.actionTags.some((t) => t.toLowerCase().includes(query)) ||
        event.sectorCategories.some((s) => s.toLowerCase().includes(query));

      const matchCategory = !category || event.sectorCategories.includes(category);
      const matchActionTag =
        activeActionTags.size === 0 ||
        event.actionTags.some((tag) => activeActionTags.has(tag));
      const matchFavorite = !favoritesOnly || favoriteIds.has(event.id);

      const eventDayStart = new Date(
        event.date.getFullYear(),
        event.date.getMonth(),
        event.date.getDate()
      ).getTime();
      const matchDate =
        dateTimes.size === 0 || dateTimes.has(eventDayStart);

      return matchSearch && matchCategory && matchActionTag && matchFavorite && matchDate;
    });

    filtered.sort((a, b) => a.date.getTime() - b.date.getTime());

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

  readonly eventsByDay = computed(() => {
    const events = this.filteredEvents();
    const byDay = new Map<number, EventItem[]>();
    for (const event of events) {
      const key = new Date(
        event.date.getFullYear(),
        event.date.getMonth(),
        event.date.getDate()
      ).getTime();
      const list = byDay.get(key);
      if (list) list.push(event);
      else byDay.set(key, [event]);
    }

    const groups: { key: number; label: string; events: EventItem[] }[] = [];
    for (const [key, dayEvents] of byDay) {
      const d = new Date(key);
      groups.push({
        key,
        label: d.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        events: dayEvents,
      });
    }
    return groups;
  });

  readonly hasRealFilter = computed(() => {
    const hasDate = this.selectedDateTimes().size > 0;
    const selected = this.selectedActionTags();
    const hasAction = ACTION_TAGS.some((tag) => !selected.has(tag));
    return hasDate || hasAction;
  });

  readonly emptyEventsMessage = computed(() => {
    if (this.favoritesFilterActive()) {
      return 'No events saved as favourite';
    }
    if (this.events().length === 0 && !this.hasRealFilter()) {
      return `No upcoming circular events in ${this.cityName()}.`;
    }
    return 'No events match the current filters.';
  });
}
