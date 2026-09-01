import { FooterComponent } from '../../components/footer/footer.component';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { AfterViewInit, AfterViewChecked } from '@angular/core';
import { OnDestroy } from '@angular/core';
import { NgZone } from '@angular/core';
import { ElementRef } from '@angular/core';
import { ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEMO_VIDEO_URL } from '../../config/media';
import { EventsService, EventItem } from '../../services/events.service';
import { FeaturedPlacesService, FeaturedPlace } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { FavoritesService } from '../../services/favorites.service';
import { SearchService } from '../../services/search.service';
import { CitySwitcherComponent } from '../../components/city-switcher/city-switcher.component';
import {
  ACTION_TAG_COLORS,
  ACTION_TAG_LABELS,
  SECTOR_CATEGORIES,
  SECTOR_CATEGORY_LABELS,
  canonicalizeSectorCategories,
} from '../../data/taxonomy';

@Component({
  selector: 'landing-page',
  standalone: true,
  imports: [CommonModule, FooterComponent, CitySwitcherComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  @ViewChild('titleList', { static: true })
  titleList!: ElementRef<HTMLUListElement>;

  demoUrl = DEMO_VIDEO_URL;
  events: EventItem[] = [];
  featuredPlaces: FeaturedPlace[] = [];
  allPlaces: FeaturedPlace[] = [];
  allEvents: EventItem[] = [];

  private onScroll?: () => void;
  private ghostItems: HTMLElement[] = [];
  private rafId: number | null = null;
  private pending = false;
  private destroyRef = inject(DestroyRef);
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;
  private lastClampMeasureKey = '';
  expandedDescriptions = signal<Set<string>>(new Set());
  clampedDescriptionIds = signal<Set<string>>(new Set());

  constructor(
    private zone: NgZone,
    private router: Router,
    private eventsService: EventsService,
    private featuredPlacesService: FeaturedPlacesService,
    public auth: AuthService,
    public eventFavorites: EventFavoritesService,
    private favoritesService: FavoritesService,
    public searchService: SearchService
  ) {
    this.eventsService.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((all) => {
      this.allEvents = all;
      this.events = [...all]
        .filter((e) => e?.date instanceof Date && !Number.isNaN(e.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 4);
      this.lastClampMeasureKey = '';
    });
    this.featuredPlacesService.getFeaturedPlaces().subscribe((places) => {
      this.featuredPlaces = places;
      this.lastClampMeasureKey = '';
      setTimeout(() => this.mountPlaceHearts(), 0);
    });
    this.featuredPlacesService.getAllPlaces().subscribe((places) => {
      this.allPlaces = places;
    });
  }

  ngAfterViewInit(): void {
    const listEl = this.titleList?.nativeElement;
    if (!listEl) return;

    // Collect elements that START as "ghost"
    this.ghostItems = Array.from(listEl.querySelectorAll('li.ghost')) as HTMLElement[];

    const applyState = () => {
      const scroll = window.scrollY || document.documentElement.scrollTop || 0;
      if (scroll < 30) {   // Very top: keep collapsed
        this.ghostItems.forEach((el) => el.classList.add('ghost'));
      } else if (scroll < 250) {    // Middle range: expand
        this.ghostItems.forEach((el) => el.classList.remove('ghost'));
      } else {    // Past threshold: collapse again
        this.ghostItems.forEach((el) => el.classList.add('ghost'));
      }
      this.pending = false;
      this.rafId = null;
    };

    const scheduleApply = () => {
      if (this.pending) return;
      this.pending = true;
      this.rafId = requestAnimationFrame(applyState);
    };

    // Run outside Angular for perf
    this.zone.runOutsideAngular(() => {
      const handler = () => scheduleApply();
      this.onScroll = handler;
      window.addEventListener('scroll', handler, { passive: true });
    });

    // Ensure correct state on first paint
    scheduleApply();
    setTimeout(() => this.mountPlaceHearts(), 0);
  }

  private mountPlaceHearts(): void {
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (!api) return;
    const placesById = new Map<string, FeaturedPlace>();
    for (const p of this.featuredPlaces) placesById.set(p.id, p);
    for (const r of this.getSearchResults()) {
      if (r.kind === 'place') placesById.set(r.item.id, r.item);
    }
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '#circular_events button.heart-btn'
    );
    buttons.forEach((btn) => {
      if (btn.dataset['heartMounted']) return;
      const id = btn.getAttribute('data-place-id');
      const place = id ? placesById.get(id) : undefined;
      if (!place?.coords) return;
      api(btn, {
        name: place.name,
        address: place.address,
        coords: place.coords,
        legacyId: place.id,
      });
      btn.dataset['heartMounted'] = '1';
    });
  }

  ngOnDestroy(): void {
    if (this.onScroll) {
      window.removeEventListener('scroll', this.onScroll as EventListener);
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  onSearchInput(ev: Event): void {
    const value = (ev.target as HTMLInputElement)?.value ?? '';
    this.searchService.setQuery(value);
    this.lastClampMeasureKey = '';
    setTimeout(() => this.mountPlaceHearts(), 0);
  }

  showSearchResults(ev?: Event): void {
    ev?.preventDefault();
    if (!this.searchService.query().trim()) return;
    const target = document.getElementById('circular_events');
    if (!target) return;
    const headerOffset = 60;
    const top = window.scrollY + target.getBoundingClientRect().top - headerOffset;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }

  goToMapPage(): void {
    this.router.navigate(['/atlas'], { queryParamsHandling: 'merge' });
  }

  goToMapWithPlace(placeId: string): void {
    this.router.navigate(['/atlas'], { queryParams: { place: placeId }, queryParamsHandling: 'merge' });
  }

  goToEventsPage(): void {
    this.router.navigate(['/events'], { queryParamsHandling: 'merge' });
  }

  goToEventPage(event: EventItem): void {
    const d = event.date;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      this.router.navigate(['/events'], { queryParams: { event: event.id }, queryParamsHandling: 'merge' });
      return;
    }
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.router.navigate(['/events'], { queryParams: { date: dateStr, event: event.id }, queryParamsHandling: 'merge' });
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

  isDescriptionExpanded(id: string): boolean {
    return this.expandedDescriptions().has(id);
  }

  descriptionNeedsMore(id: string, _description: string): boolean {
    if (this.isDescriptionExpanded(id)) return true;
    return this.clampedDescriptionIds().has(id);
  }

  toggleDescription(id: string, ev?: Event): void {
    ev?.stopPropagation();
    const next = new Set(this.expandedDescriptions());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedDescriptions.set(next);
    this.lastClampMeasureKey = '';
  }

  ngAfterViewChecked(): void {
    const search = this.searchService.query() ? this.getSearchResults() : [];
    const key = [
      ...this.events.map((e) => e.id),
      ...this.featuredPlaces.map((p) => `place-${p.id}`),
      ...search.map((r) => (r.kind === 'event' ? r.item.id : `place-${r.item.id}`)),
      [...this.expandedDescriptions()].sort().join(','),
    ].join('|');
    if (key === this.lastClampMeasureKey) return;
    this.lastClampMeasureKey = key;
    queueMicrotask(() => this.measureClampedDescriptions());
  }

  private measureClampedDescriptions(): void {
    const nodes = document.querySelectorAll<HTMLElement>(
      '#circular_events .event-card .event-description-block:not(.expanded) .event-description'
    );
    const next = new Set<string>();
    nodes.forEach((el) => {
      const id = el.closest('.event-card')?.getAttribute('data-card-id');
      if (!id) return;
      if (el.scrollHeight > el.clientHeight + 1) next.add(id);
    });
    const prev = this.clampedDescriptionIds();
    if (prev.size !== next.size || [...next].some((id) => !prev.has(id))) {
      this.clampedDescriptionIds.set(next);
    }
  }

  private categoryImageIcons(id: string): string[] {
    if (id === 'apparel') return ['assets/icons/clothing-shirt.png', 'assets/icons/clothing-trainers.png'];
    if (id === 'electronics') return ['assets/icons/electronics-devices.png', 'assets/icons/electronics-fridge.png'];
    if (id === 'music') return ['assets/icons/music-hdd.png', 'assets/icons/electronics-headphones.png'];
    if (id === 'home-garden') return ['assets/icons/furniture-lamp.png', 'assets/icons/furniture-chair.png'];
    if (id === 'books-comics-magazines') return ['assets/icons/books-open.png', 'assets/icons/books-comics.png'];
    if (id === 'cycling-sports') {
      return ['assets/icons/sports-bicycle.png', 'assets/icons/sports-basketball.png', 'assets/icons/sports-barbell.png'];
    }
    return [];
  }

  getSearchResults(): Array<{ kind: 'place'; item: FeaturedPlace } | { kind: 'event'; item: EventItem }> {
    const q = this.searchService.query().toLowerCase().trim();
    if (!q) return [];
    const matches = (text: string | undefined | null) => String(text || '').toLowerCase().includes(q);
    const results: Array<{ kind: 'place'; item: FeaturedPlace } | { kind: 'event'; item: EventItem }> = [];
    for (const p of this.allPlaces) {
      if (
        matches(p.name) ||
        matches(p.description) ||
        matches(p.address) ||
        matches(p.storeType) ||
        matches(p.label)
      ) {
        results.push({ kind: 'place', item: p });
      }
    }
    for (const e of this.allEvents) {
      if (
        matches(e.title) ||
        matches(e.description) ||
        matches(e.category) ||
        matches(e.location)
      ) {
        results.push({ kind: 'event', item: e });
      }
    }
    return results;
  }

  async toggleFavorite(eventId: string): Promise<void> {
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      this.auth.openModal();
      return;
    }
    await this.eventFavorites.toggle(eventId);
  }
}
