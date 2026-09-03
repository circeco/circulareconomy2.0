import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-phone-tab-bar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './phone-tab-bar.component.html',
  styleUrls: ['./phone-tab-bar.component.scss'],
})
export class PhoneTabBarComponent {
  private router = inject(Router);
  private auth = inject(AuthService);

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.pathOf(this.router.url)),
      startWith(this.pathOf(this.router.url))
    ),
    { initialValue: this.pathOf(this.router.url) }
  );

  readonly tabs = [
    { id: 'action', label: 'Search places and events', link: '/', exact: true, disabled: false },
    { id: 'atlas', label: 'Circular Atlas', link: '/atlas', exact: false, disabled: false },
    { id: 'events', label: 'Circular Events', link: '/events', exact: false, disabled: false },
    { id: 'user', label: 'User', link: '/account', exact: false, disabled: false },
  ] as const;

  isActive(tab: (typeof this.tabs)[number]): boolean {
    if (tab.disabled) return false;
    const path = this.path();
    if (tab.exact) return path === '/' || path === '';
    return path.startsWith(tab.link);
  }

  onTabClick(ev: Event, tab: (typeof this.tabs)[number]): void {
    if (tab.disabled) {
      ev.preventDefault();
      return;
    }
    if (tab.id === 'user') this.onUserTab(ev);
  }

  onUserTab(ev: Event): void {
    if (this.auth.displayUser()) return;
    ev.preventDefault();
    this.auth.openModal();
  }

  private pathOf(url: string): string {
    return String(url || '').split('?')[0].split('#')[0];
  }
}
