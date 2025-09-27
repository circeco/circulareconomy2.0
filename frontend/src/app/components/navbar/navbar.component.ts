import { Component, AfterViewInit, OnDestroy, HostListener, NgZone, signal } from '@angular/core';
import { CommonModule, AsyncPipe, NgIf } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, NgIf, AsyncPipe],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements AfterViewInit, OnDestroy {
  // which section is active for the "active" class
  activeSection = signal<string>('title_section');
  // mobile hamburger state (adds 'responsive' class)
  menuOpen = signal<boolean>(false);

  private observer?: IntersectionObserver;
  private readonly sectionIds = ['title_section', 'circular_action', 'circular_atlas', 'footer'];
  private readonly headerOffset = 60; // px – adjust if your header height differs

  constructor(public auth: AuthService, private zone: NgZone) {}

  ngAfterViewInit(): void {
    // ScrollSpy with IntersectionObserver
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          // pick the entry with the greatest intersection ratio
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

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  toggleHamburger(): void {
    this.menuOpen.update(v => !v);
  }

  // Smooth scroll to a section id (keeps SPA behavior)
  goTo(id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    // close menu on mobile
    this.menuOpen.set(false);

    const rect = target.getBoundingClientRect();
    const absoluteY = window.scrollY + rect.top - this.headerOffset;
    window.scrollTo({ top: Math.max(absoluteY, 0), behavior: 'smooth' });
  }

  openLogin(): void { this.auth.openModal(); }
  async logout(): Promise<void> { await this.auth.signOutOnce(); }

  // Keep “Back to top” keyboard accessibility working
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && this.menuOpen()) this.menuOpen.set(false);
  }
}

