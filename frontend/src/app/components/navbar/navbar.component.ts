import {
  Component,
  AfterViewInit,
  OnDestroy,
  HostListener,
  NgZone,
  signal
} from '@angular/core';
import { CommonModule, AsyncPipe, NgIf } from '@angular/common';
import { Router, NavigationEnd, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SearchService } from '../../services/search.service';
import { ViewportService } from '../../services/viewport.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, NgIf, AsyncPipe, RouterLink],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements AfterViewInit, OnDestroy {
  // Which section is active for the "active" class (landing only)
  activeSection = signal<string>('title_section');

  // Mobile hamburger state (adds 'responsive' class)
  menuOpen = signal<boolean>(false);
  logoMenuOpen = signal<boolean>(false);

  // Route-aware: landing vs atlas
  isLanding = signal<boolean>(true);
  admin$!: Observable<boolean>;

  private observer?: IntersectionObserver;
  private readonly sectionIds = ['title_section', 'circular_events', 'circular_action', 'circular_atlas_demo', 'footer'];
  private readonly headerOffset = 60; // px – adjust to the header height

  constructor(
    public auth: AuthService,
    public searchService: SearchService,
    private zone: NgZone,
    private router: Router,
    private viewport: ViewportService
  ) {
    this.admin$ = this.auth.isAdmin();
    // Watch route changes to toggle landing/atlas mode and (re)wire scrollspy
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        this.updateModeFromUrl();
        this.destroyScrollSpy();
        if (this.isLanding()) {
          // Ensure landing DOM is ready before observing
          queueMicrotask(() => this.initScrollSpy());
        }
      });
  }

  ngAfterViewInit(): void {
    this.updateModeFromUrl();
    if (this.isLanding()) {
      this.initScrollSpy();
    }
  }

  ngOnDestroy(): void {
    this.destroyScrollSpy();
    // Clean up body class on destroy just in case
    document.body.classList.remove('snap-landing');
  }

  private currentPath(): string {
    return this.router.url.split('?')[0].split('#')[0];
  }

  private updateModeFromUrl(): void {
    const url = this.currentPath();
    // Atlas, events, and admin share the logo site menu; everything else is landing.
    const landing =
      !url.startsWith('/atlas') &&
      !url.startsWith('/events') &&
      !url.startsWith('/admin');
    this.isLanding.set(landing);
    this.logoMenuOpen.set(false);
    this.toggleSnapClass(landing);
  }

  private toggleSnapClass(enable: boolean): void {
    // Adds/removes a class on <body> so we can scope scroll-snap to Landing only
    if (enable && !this.viewport.isPhone()) {
      document.body.classList.add('snap-landing');
    } else {
      document.body.classList.remove('snap-landing');
    }
  }

  private initScrollSpy(): void {
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          // Pick the entry with the greatest intersection ratio
          const visible = entries
            .filter(e => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible?.target?.id) {
            this.zone.run(() => this.activeSection.set(visible.target.id));
          }
        },
        {
          root: null,
          rootMargin: `-${this.headerOffset}px 0px -60% 0px`,
          threshold: [0, 0.25, 0.5, 0.75, 1],
        }
      );

      this.sectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) this.observer!.observe(el);
      });
    });
  }

  private destroyScrollSpy(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  toggleHamburger(): void {
    this.menuOpen.update(v => !v);
  }

  onLogoClick(ev: Event): void {
    if (this.isLanding()) {
      this.goHome();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.logoMenuOpen.update((open) => !open);
  }

  goToFromLogo(id: string): void {
    this.logoMenuOpen.set(false);
    if (id === 'circular_events') {
      this.router.navigate(['/events'], { queryParamsHandling: 'merge' });
      return;
    }
    if (id === 'circular_atlas_demo') {
      this.router.navigate(['/atlas'], { queryParamsHandling: 'merge' });
      return;
    }
    this.router.navigate(['/'], { queryParamsHandling: 'merge' }).then(() => {
      const tryScroll = (attempts = 0) => {
        if (document.getElementById('circular_action')) {
          this.scrollToSection('circular_action');
          return;
        }
        if (attempts < 20) setTimeout(() => tryScroll(attempts + 1), 50);
      };
      tryScroll();
    });
  }

  // Smooth scroll to a section id (landing only)
  goTo(id: string): void {
    if (!this.isLanding()) {
      // If clicked from atlas for any reason, just send home
      this.router.navigate(['/'], { queryParamsHandling: 'merge' });
      return;
    }

    // Close menu on mobile
    this.menuOpen.set(false);

    // Circular Events / Circular Atlas should route to dedicated pages.
    if (id === 'circular_events') {
      this.router.navigate(['/events'], { queryParamsHandling: 'merge' });
      return;
    }

    // Circular Atlas should route to the atlas page, not scroll on landing
    if (id === 'circular_atlas_demo') {
      this.router.navigate(['/atlas'], { queryParamsHandling: 'merge' });
      return;
    }

    // Special case: Contact -> scroll to the true bottom
    if (id === 'footer') {
      this.scrollToBottom();
      return;
    }

    this.scrollToSection(id);
  }

  // Logo always goes "home" (landing)
  goHome(): void {
    if (this.isLanding()) {
      this.goTo('title_section');
    } else {
      this.router.navigate(['/'], { queryParamsHandling: 'merge' });
    }
  }

  private scrollToSection(id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const absoluteY = window.scrollY + rect.top - this.headerOffset;
    window.scrollTo({ top: Math.max(absoluteY, 0), behavior: 'smooth' });
  }

  private scrollToBottom(): void {
    // Robust max document height
    const maxHeight = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight,  document.documentElement.offsetHeight,
      document.body.clientHeight,  document.documentElement.clientHeight
    );
    const top = Math.max(0, maxHeight - window.innerHeight);
    window.scrollTo({ top, behavior: 'smooth' });
  }

  get nonLandingTitle(): string {
    const url = this.currentPath();
    if (url.startsWith('/events')) {
      return 'Circular Events: Find circular solutions in your area!';
    }
    if (url.startsWith('/admin')) return 'CIRCECO';
    return 'CIRCULAR ATLAS: Find circular solutions in your area!';
  }

  showSearchBar(): boolean {
    return false;
  }

  onSearchInput(ev: Event): void {
    const value = (ev.target as HTMLInputElement)?.value ?? '';
    this.searchService.setQuery(value);
  }

  openLogin(): void { this.auth.openModal(); }
  async logout(): Promise<void> {
    await this.auth.signOutOnce();
    // Ensure a clean post-logout state and always land on home.
    window.location.assign('/');
  }

  @HostListener('document:click')
  onDocumentClick() {
    if (this.logoMenuOpen()) this.logoMenuOpen.set(false);
  }

  // Keep “Back to top” keyboard accessibility working
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      if (this.menuOpen()) this.menuOpen.set(false);
      if (this.logoMenuOpen()) this.logoMenuOpen.set(false);
    }
  }
}
