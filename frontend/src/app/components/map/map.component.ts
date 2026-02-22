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
import { MapService } from '../../services/map.service';
import { PlacesFilter, Feature } from '../../services/places-filter.service';

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
  favoritesVisible = true;
  favoritesDisabled = false;

  // categories and enabled set get initialized in ngOnInit (after DI available)
  categoryIds: string[] = [];
  enabledCategories = new Set<string>();

  // filtered list snapshot for template
  filteredList: Feature[] = [];

  // queue hearts until favourites service ready
  private heartMountQueue: Array<{ btn: HTMLButtonElement, place: any }> = [];

  constructor(
    private map: MapService,
    private filter: PlacesFilter,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
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

    // Build enrichment index (independent of map readiness)
    fetch(new URL('assets/data/circular_places.geojson', document.baseURI).toString())
      .then(r => r.json()).then(fc => this.filter.buildIndex(fc));

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

  onToggleFavorites(ev: Event) {
    ev.preventDefault(); ev.stopPropagation();
    if (this.favoritesDisabled) return (window as any).circeco?.openAuthModal?.();
    this.favoritesVisible = !this.favoritesVisible;
    this.map.setFavoritesVisibility(this.favoritesVisible);
  }

  // ---------- Map interactions ----------
  focusOnPlaceById(placeId: string): void {
    const url = new URL('assets/data/circular_places.geojson', document.baseURI).toString();
    fetch(url)
      .then((r) => r.json())
      .then((fc: { features?: Feature[] }) => {
        const features = fc?.features ?? [];
        const feat = features.find((f: Feature) => String((f as any)?.id ?? '') === String(placeId));
        if (feat && feat.geometry?.coordinates) {
          this.zone.run(() => {
            this.focusOn(feat);
            this.cdr.markForCheck();
          });
        }
      })
      .catch(() => {});
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
    btn.className = 'heart-btn';
    btn.setAttribute('aria-pressed', 'false');
    this.mountHeart(btn, place);

    header.appendChild(h); header.appendChild(btn); el.appendChild(header);

    if (props.STORE_TYPE) {
      const t = document.createElement('p'); t.style.margin = '4px 0'; t.textContent = props.STORE_TYPE; el.appendChild(t);
    }
    if (props.ADDRESS_LINE1 || props.ADDRESS) {
      const a = document.createElement('p'); a.className = 'address'; a.textContent = props.ADDRESS_LINE1 || props.ADDRESS || ''; el.appendChild(a);
    }
    const rawWeb = (props.WEB || '').replace(/^https?:\/\//i, ''); const href = this.normalizeWebHref(rawWeb);
    if (href) {
      const a = document.createElement('a'); a.target = '_blank'; a.rel = 'noopener'; a.href = href; a.textContent = rawWeb; el.appendChild(a);
    }
    if (props.DESCRIPTION) {
      const d = document.createElement('p'); d.textContent = props.DESCRIPTION; el.appendChild(d);
    }

    return el;
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
      btn.textContent = '♡';
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
