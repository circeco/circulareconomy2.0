import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  ViewChildren,
  QueryList,
  OnDestroy,
  AfterViewInit,
  OnInit,
  NgZone,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { MapService } from '../../services/map.service';
import { PlacesFilter, Feature } from '../../services/places-filter.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { FeaturedPlacesService } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import {
  ACTION_TAG_COLORS,
  ACTION_TAGS,
  ACTION_TAG_LABELS,
  ActionTag,
  canonicalizeSectorCategory,
  SECTOR_CATEGORY_LABELS,
  SectorCategory,
} from '../../data/taxonomy';

@Component({
  selector: 'atlas-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent implements AfterViewInit, OnInit, OnDestroy {
  @ViewChild('mapHost', { static: true }) mapHost!: ElementRef<HTMLDivElement>;
  @ViewChildren('heartBtn') heartButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  // --- UI state ---
  listOpen = false;
  favoritesVisible = false;
  favoritesDisabled = true;

  // categories and enabled set get initialized in ngOnInit (after DI available)
  categoryIds: string[] = [];
  enabledCategories = new Set<string>();
  actionTagIds: string[] = ACTION_TAGS.slice();
  enabledActionTags = new Set<string>(this.actionTagIds);
  private readonly actionTagColors: Record<string, string> = ACTION_TAG_COLORS as Record<string, string>;

  // filtered list snapshot for template
  filteredList: Feature[] = [];

  // queue hearts until favourites service ready
  private heartMountQueue: Array<{ btn: HTMLButtonElement, place: any }> = [];
  private subs: Subscription[] = [];

  constructor(
    private map: MapService,
    private filter: PlacesFilter,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private cityContext: CityContextService,
    private cities: CitiesService,
    private featuredPlaces: FeaturedPlacesService,
    private auth: AuthService
  ) { }

  // Optional public API if the page wants to control the overlay
  public openList() { this.toggleList(true); }
  public closeList() { this.toggleList(false); }
  public toggleListPublic() { this.toggleList(); }

  ngOnInit(): void {
    // initialize categories
    this.categoryIds = this.filter.CATEGORY_IDS.slice();
    this.enabledCategories = new Set(this.categoryIds);

    // keep map filter in sync with categories (map-side work is fine outside zone)
    this.filter.enabledCategories$.subscribe(set => this.map.setCategoryFilter(set));
    this.filter.enabledActionTagsState$.subscribe(set => this.map.setActionTagFilter(set));

    // initialize action tags filter with all tags enabled
    this.filter.setActionTags(this.enabledActionTags);

    // Drive favorites toggle state from real auth stream to avoid window-event timing races.
    this.subs.push(
      this.auth.user$.subscribe((user) => {
        const authed = !!user;
        this.favoritesDisabled = !authed;
        if (!authed) {
          this.favoritesVisible = false;
        }
        this.map.setFavoritesVisibility(authed && this.favoritesVisible);
      })
    );
  }

  ngAfterViewInit(): void {
    this.map.init(this.mapHost.nativeElement);

    // Wait until map & layers are rendered at least once
    this.map.onReady().subscribe(() => {
      // 0) Focus on place from route query param (e.g. /atlas?place=ID)
      this.route.queryParams.subscribe((params) => {
        const placeId = params['place'];
        if (placeId && typeof placeId === 'string') {
          this.focusOnPlaceById(placeId);
        }
      });

      // 1) Feed visible features into the store — run INSIDE Angular so UI updates immediately
      this.map.queryRenderedFeatures$().subscribe(fs => {
        this.zone.run(() => {
          this.filter.setAllFeatures(fs as any);
          this.cdr.markForCheck();
        });
      });

      // 2) Open popup on dot click (places or favorites)
      this.map.onFeatureClick().subscribe(({ feature, coords }) => {
        this.zone.run(() => {
          const props = this.propsOf(feature as any);
          const content = this.buildPopupContent({ ...(feature as any), properties: props });
          this.map.openPopup(coords, content);
          this.cdr.markForCheck();
        });
      });

      // Category filter stream already wired in ngOnInit
    });

    this.subs.push(
      this.featuredPlaces.getGeoJsonForCurrentCity().subscribe((fc) => {
        this.map.setPlacesData(fc);
        this.filter.buildIndex(fc as any);
      })
    );

    this.subs.push(
      combineLatest([this.cityContext.cityId$, this.cities.cities$]).subscribe(([cityId, cities]) => {
        const city = cities.find((c) => c.id === cityId);
        const lat = city?.center?.lat;
        const lng = city?.center?.lng;
        if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {
          this.map.flyToCity([lng, lat], 11);
        }
      })
    );

    // 3) Update the displayed list when filter output changes — run INSIDE Angular
    this.filter.filteredFeatures$.subscribe(list => {
      this.zone.run(() => {
        this.filteredList = list;
        this.cdr.markForCheck();
        setTimeout(() => this.mountListHearts(), 0);
      });
    });

    // Favourites events
    window.addEventListener('favorites:update', this.onFavUpdate);
    window.addEventListener('favorites:auth', this.onFavAuth);
    window.addEventListener('favorites-ready', this.onFavReady);
  }

  ngOnDestroy(): void {
    window.removeEventListener('favorites:update', this.onFavUpdate);
    window.removeEventListener('favorites:auth', this.onFavAuth);
    window.removeEventListener('favorites-ready', this.onFavReady);
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
    this.map.destroy();
  }

  // ---------- Host listeners ----------
  @HostListener('window:resize') onWindowResize() { this.map.resize(); }
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) { if (ev.key === 'Escape' && this.listOpen) this.toggleList(false); }

  // ---------- Overlay ----------
  toggleList(force?: boolean) {
    this.listOpen = typeof force === 'boolean' ? force : !this.listOpen;
    setTimeout(() => this.onWindowResize(), 300);
  }

  onOverlayBackdrop(_ev: MouseEvent) { this.toggleList(false); }

  // ---------- UI handlers ----------
  onFilter(ev: Event) { this.filter.setFilter((ev.target as HTMLInputElement).value); }

  onToggleCategory(ev: Event, cat: string) {
    ev.preventDefault(); ev.stopPropagation();
    if (this.enabledCategories.has(cat)) this.enabledCategories.delete(cat);
    else this.enabledCategories.add(cat);
    this.filter.setCategories(this.enabledCategories);
  }

  isCatEnabled(cat: string) { return this.enabledCategories.has(cat); }

  onToggleActionTag(ev: Event, tag: string) {
    ev.preventDefault(); ev.stopPropagation();
    if (this.enabledActionTags.has(tag)) this.enabledActionTags.delete(tag);
    else this.enabledActionTags.add(tag);
    this.filter.setActionTags(this.enabledActionTags);
  }

  isActionTagEnabled(tag: string) { return this.enabledActionTags.has(tag); }
  actionTagLabel(tag: string) { return ACTION_TAG_LABELS[tag as ActionTag] || tag; }
  actionTagColor(tag: string) { return this.actionTagColors[tag] || '#45818e'; }
  actionTagTextColor(tag: string) {
    return tag === 'recycle' || tag === 'reduce' ? '#0c343d' : '#ffffff';
  }
  categoryLabel(cat: string) { return SECTOR_CATEGORY_LABELS[cat as SectorCategory] || cat; }
  categoryImageIcons(cat: string): string[] {
    if (cat === 'apparel') return ['assets/icons/clothing-shirt.png', 'assets/icons/clothing-trainers.png'];
    if (cat === 'home-garden') return ['assets/icons/furniture-lamp.png', 'assets/icons/furniture-chair.png'];
    if (cat === 'cycling-sports') return ['assets/icons/sports-bicycle.png', 'assets/icons/sports-basketball.png', 'assets/icons/sports-barbell.png'];
    if (cat === 'electronics') return ['assets/icons/electronics-devices.png', 'assets/icons/electronics-fridge.png'];
    if (cat === 'books-comics-magazines') return ['assets/icons/books-open.png', 'assets/icons/books-comics.png'];
    if (cat === 'music') return ['assets/icons/music-hdd.png', 'assets/icons/electronics-headphones.png'];
    return [];
  }
  categoryEmojiIcon(cat: string): string {
    const map = {
      apparel: '👕',
      'home-garden': '🏡',
      'cycling-sports': '🚲',
      electronics: '💻',
      'books-comics-magazines': '📚',
      music: '🎵',
    } as const;
    return map[cat as keyof typeof map] || '•';
  }

  onToggleFavorites(ev: Event) {
    ev.preventDefault(); ev.stopPropagation();
    if (this.favoritesDisabled) return (window as any).circeco?.openAuthModal?.();
    this.favoritesVisible = !this.favoritesVisible;
    this.map.setFavoritesVisibility(this.favoritesVisible);
  }

  // ---------- Map interactions ----------
  focusOnPlaceById(placeId: string): void {
    const feat = this.filteredList.find((f: Feature) => String((f as any)?.id ?? '') === String(placeId));
    if (!feat || !feat.geometry?.coordinates) return;
    this.zone.run(() => {
      this.focusOn(feat);
      this.cdr.markForCheck();
    });
  }

  focusOn(feature: Feature) {
    if (!feature.geometry?.coordinates) return;
    const props = this.propsOf(feature);
    const center = feature.geometry.coordinates;
    const content = this.buildPopupContent({ ...feature, properties: props });
    this.map.flyTo(center, 14);
    this.map.openPopup(center, content);
  }

  propsOf(f: Feature) { return this.filter.enrichForUI(f); }

  // ---------- Hearts ----------
  onHeartClick(btn: HTMLButtonElement, feature: Feature) {
    if (!(btn as any).dataset?.heartMounted) {
      this.mountHeart(btn, this.buildPlaceForHeart(feature));
      setTimeout(() => btn.click());
    }
  }

  private normalizeWebHref(raw: string) {
    const s = (raw || '').trim(); if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : ('https://' + s.replace(/^https?:\/\//i, ''));
  }

  private buildPlaceForHeart(feat: Feature) {
    const p = this.propsOf(feat);
    const c = feat.geometry?.coordinates || [0, 0] as [number, number];
    const legacyId = String((feat as any)?.id || (feat as any)?.properties?.id || `${feat?.layer?.id || 'feat'}:${p.STORE_NAME || p.NAME || 'Unknown'}:${c[0]},${c[1]}`);
    const place: any = {
      name: p.STORE_NAME || p.NAME || 'Unknown place',
      address: p.ADDRESS_LINE1 || p.ADDRESS || '',
      coords: { lng: Number(c[0]), lat: Number(c[1]) },
      legacyId
    };
    const fn = (window as any).circeco?.favorites?.computePlaceKey;
    place.key = fn ? fn(place) : legacyId;
    return place;
  }

  private buildPopupContent(feat: Feature) {
    const props = this.propsOf(feat);
    const place = this.buildPlaceForHeart({ ...feat, properties: props });

    const el = document.createElement('div');
    const header = document.createElement('div'); header.className = 'popup-header';

    const h = document.createElement('h4'); h.style.margin = '0';
    h.textContent = props.STORE_NAME || props.NAME || 'Unknown place';

    const btn = document.createElement('button');
    btn.className = 'heart-btn popup-heart-btn';
    btn.setAttribute('aria-pressed', 'false');
    this.mountHeart(btn, place);

    header.appendChild(h); header.appendChild(btn); el.appendChild(header);

    if (props.ADDRESS_LINE1 || props.ADDRESS) {
      const a = document.createElement('p'); a.className = 'address'; a.textContent = props.ADDRESS_LINE1 || props.ADDRESS || ''; el.appendChild(a);
    }
    const rawWeb = (props.WEB || '').replace(/^https?:\/\//i, ''); const href = this.normalizeWebHref(rawWeb);
    if (href) {
      const a = document.createElement('a');
      a.className = 'website-link';
      a.target = '_blank';
      a.rel = 'noopener';
      a.href = href;
      a.textContent = rawWeb;
      el.appendChild(a);
    }

    const sectors = this.popupSectorIdsFromProps(props as any);
    if (sectors.length) {
      const icons = document.createElement('div');
      icons.className = 'popup-category-icons';
      const renderedIconPaths = new Set<string>();
      const renderedFallbacks = new Set<string>();
      for (const sector of sectors) {
        const paths = this.categoryImageIcons(sector);
        if (paths.length) {
          for (const path of paths) {
            if (renderedIconPaths.has(path)) continue;
            renderedIconPaths.add(path);
            const icon = document.createElement('span');
            icon.className = 'popup-category-icon';
            icon.style.setProperty('--icon-url', `url('${path}')`);
            icons.appendChild(icon);
          }
        } else {
          const emoji = this.categoryEmojiIcon(sector);
          if (renderedFallbacks.has(emoji)) continue;
          renderedFallbacks.add(emoji);
          const fallback = document.createElement('span');
          fallback.className = 'popup-category-fallback';
          fallback.textContent = emoji;
          icons.appendChild(fallback);
        }
      }
      el.appendChild(icons);
    }

    if (props.DESCRIPTION) {
      const d = document.createElement('p');
      d.className = 'description';
      d.textContent = props.DESCRIPTION;
      el.appendChild(d);
    }

    return el;
  }

  private popupSectorIdsFromProps(props: any): string[] {
    const out: SectorCategory[] = [];
    const normalizeToken = (value: unknown): string => {
      return String(value || '')
        .trim()
        .replace(/^[\[\]\{\}"']+|[\[\]\{\}"']+$/g, '')
        .trim();
    };
    const tokensFromUnknown = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.map((v) => normalizeToken(v)).filter(Boolean);
      }
      if (typeof value === 'string') {
        const raw = value.trim();
        if (raw.startsWith('[') && raw.endsWith(']')) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map((v) => normalizeToken(v)).filter(Boolean);
          } catch {
            // fall back to delimiter split below
          }
        }
        return raw.split(/[,;|/]/).map((v) => normalizeToken(v)).filter(Boolean);
      }
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>)
          .map((v) => normalizeToken(v))
          .filter(Boolean);
      }
      return [];
    };
    const add = (raw: unknown) => {
      const token = String(raw || '').trim().toLowerCase();
      if (!token) return;
      if (token === 'electronics-books-music') {
        add('electronics');
        add('books-comics-magazines');
        add('music');
        return;
      }
      const canonical = canonicalizeSectorCategory(token);
      if (canonical && !out.includes(canonical)) out.push(canonical);
    };

    const fields = [
      props?.CATEGORIES,
      props?.CATEGORY,
      props?.sectorCategories,
      props?.sectorCategory,
      props?.category,
    ];
    for (const field of fields) {
      tokensFromUnknown(field).forEach((v) => add(v));
    }

    if (!out.length) {
      for (const inferred of this.popupInferSectorsFromText(props)) {
        if (!out.includes(inferred)) out.push(inferred);
      }
    }

    return out;
  }

  private popupInferSectorsFromText(props: any): SectorCategory[] {
    const textBits = [
      props?.DESCRIPTION,
      props?.STORE_TYPE,
      props?.CATEGORY,
      typeof props?.CATEGORIES === 'string' ? props.CATEGORIES : '',
      Array.isArray(props?.CATEGORIES) ? props.CATEGORIES.join(' ') : '',
    ];
    const text = textBits.join(' ').toLowerCase();
    const out: SectorCategory[] = [];
    const add = (cat: SectorCategory) => { if (!out.includes(cat)) out.push(cat); };

    if (/(book|comic|magazine|library)/.test(text)) add('books-comics-magazines');
    if (/(cycle|cycling|bike|bicycle|sport|fitness|gym)/.test(text)) add('cycling-sports');
    if (/(cloth|clothing|fashion|apparel|shoe|sneaker|accessor)/.test(text)) add('apparel');
    if (/(electronic|device|phone|laptop|computer|appliance|repair\s*caf[eé])/.test(text)) add('electronics');
    if (/(music|vinyl|record|instrument|audio|hifi|headphone)/.test(text)) add('music');
    if (/(furniture|home|garden|chair|lamp|sofa|antique)/.test(text)) add('home-garden');

    return out;
  }

  private mountHeart(btn: HTMLButtonElement, place: any) {
    btn.addEventListener('click', ev => ev.stopPropagation());
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (api) {
      api(btn, place);
      (btn as any).dataset.heartMounted = '1';
    }
    else {
      this.heartMountQueue.push({ btn, place });
      btn.textContent = '♥';
    }
  }

  private flushHeartQueue() {
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (!api) return;
    while (this.heartMountQueue.length) {
      const { btn, place } = this.heartMountQueue.shift()!;
      if (!(btn as any).dataset.heartMounted) {
        api(btn, place);
        (btn as any).dataset.heartMounted = '1';
      }
    }
  }

  // favourites events
  private onFavUpdate = (_e: Event) => {
    this.zone.run(() => {
      this.mountListHearts();
      this.cdr.markForCheck();
    });
  };

  private onFavAuth(e: any) {
    const authed = !!e?.detail?.user;
    this.favoritesDisabled = !authed;
    if (!authed) this.favoritesVisible = false;
    // safe even if early; MapService guards if layer isn't ready yet
    this.map.setFavoritesVisibility(authed && this.favoritesVisible);
  };

  private onFavReady() { this.flushHeartQueue() };

  private mountListHearts() {
    const api = (window as any).circeco?.favorites?.mountHeartButton;
    if (!api || !this.heartButtons) return;
    this.heartButtons.forEach((ref, idx) => {
      const btn = ref.nativeElement;
      if ((btn as any).dataset.heartMounted) return;
      const feat = this.filteredList[idx];
      if (!feat) return;
      const place = this.buildPlaceForHeart(feat);
      api(btn, place);
      (btn as any).dataset.heartMounted = '1';
    });
  }
}
