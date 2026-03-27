import { FooterComponent } from '../../components/footer/footer.component';
import { Component, DestroyRef, inject } from '@angular/core';
import { AfterViewInit } from '@angular/core';
import { OnDestroy } from '@angular/core';
import { NgZone } from '@angular/core';
import { ElementRef } from '@angular/core';
import { ViewChild, ViewChildren } from '@angular/core';
import { QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEMO_VIDEO_URL } from '../../config/media';
import { EventsService, EventItem } from '../../services/events.service';
import { FeaturedPlacesService, FeaturedPlace } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { EventFavoritesService } from '../../services/event-favorites.service';
import { FavoritesService } from '../../services/favorites.service';
import { SearchService } from '../../services/search.service';
import { CitySwitcherComponent } from '../../components/city-switcher/city-switcher.component';

@Component({
  selector: 'landing-page',
  standalone: true,
  imports: [CommonModule, FooterComponent, CitySwitcherComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements AfterViewInit, OnDestroy {
  @ViewChild('titleList', { static: true })
  titleList!: ElementRef<HTMLUListElement>;
  @ViewChildren('placeHeartBtn') placeHeartButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  demoUrl = DEMO_VIDEO_URL;
  events: EventItem[] = [];
  featuredPlaces: FeaturedPlace[] = [];
  allPlaces: FeaturedPlace[] = [];
  allEvents: EventItem[] = [];

  private onScroll?: () => void;
  private heartChangesSub?: Subscription;
  private ghostItems: HTMLElement[] = [];
  private rafId: number | null = null;
  private pending = false;
  private destroyRef = inject(DestroyRef);

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
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 4);
    });
    this.featuredPlacesService.getFeaturedPlaces().subscribe((places) => {
      this.featuredPlaces = places;
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
    this.heartChangesSub = this.placeHeartButtons?.changes?.subscribe(() => setTimeout(() => this.mountPlaceHearts(), 0));
  }

  private mountPlaceHearts(): void {
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (!api || !this.placeHeartButtons) return;
    const searchPlaces = this.searchService.query()
      ? this.getSearchResults().filter((r): r is { kind: 'place'; item: FeaturedPlace } => r.kind === 'place').map((r) => r.item)
      : [];
    const places = [...searchPlaces, ...this.featuredPlaces];
    this.placeHeartButtons.forEach((ref, i) => {
      const btn = ref.nativeElement;
      if ((btn as any).dataset?.heartMounted) return;
      const place = places[i];
      if (!place?.coords) return;
      const p = {
        name: place.name,
        address: place.address,
        coords: place.coords,
        legacyId: place.id,
      };
      api(btn, p);
      (btn as any).dataset.heartMounted = '1';
    });
  }

  ngOnDestroy(): void {
    this.heartChangesSub?.unsubscribe();
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
  }

  goToMapPage(): void {
    this.router.navigate(['/atlas']);
  }

  goToMapWithPlace(placeId: string): void {
    this.router.navigate(['/atlas'], { queryParams: { place: placeId } });
  }

  goToEventsPage(): void {
    this.router.navigate(['/events']);
  }

  goToEventPage(event: EventItem): void {
    const d = event.date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.router.navigate(['/events'], { queryParams: { date: dateStr, event: event.id } });
  }

  getSearchResults(): Array<{ kind: 'place'; item: FeaturedPlace } | { kind: 'event'; item: EventItem }> {
    const q = this.searchService.query().toLowerCase().trim();
    if (!q) return [];
    const matches = (text: string) => text.toLowerCase().includes(q);
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
    this.eventFavorites.toggle(eventId);
  }
}
