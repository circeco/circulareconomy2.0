import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from './services/auth.service';
import { EventFavoritesService } from './services/event-favorites.service';
import { FavoritesService } from './services/favorites.service';
import { ViewportService } from './services/viewport.service';
import { PhoneChromeService } from './services/phone-chrome.service';
import { LoginComponent } from './components/login/login.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { CitySwitcherComponent } from './components/city-switcher/city-switcher.component';
import { PhoneTopBarComponent } from './components/phone-top-bar/phone-top-bar.component';
import { PhoneTabBarComponent } from './components/phone-tab-bar/phone-tab-bar.component';
import { CityListComponent } from './components/city-list/city-list.component';

declare global {
  interface Window {
    myFunction?: () => void;
    sendMail?: (form: HTMLFormElement) => boolean;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    NavbarComponent,
    LoginComponent,
    CitySwitcherComponent,
    PhoneTopBarComponent,
    PhoneTabBarComponent,
    CityListComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private router = inject(Router);
  readonly viewport = inject(ViewportService);
  readonly chrome = inject(PhoneChromeService);

  constructor(
    public auth: AuthService,
    private _favorites: FavoritesService,
    private _eventFavorites: EventFavoritesService
  ) {}

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.pathOf(this.router.url)),
      startWith(this.pathOf(this.router.url))
    ),
    { initialValue: this.pathOf(this.router.url) }
  );

  readonly isAdmin = computed(() => this.path().startsWith('/admin'));
  readonly phoneShell = computed(() => this.viewport.isPhone() && !this.isAdmin());

  openLogin() { this.auth.openModal(); }
  async logout() { await this.auth.signOutOnce(); }

  private pathOf(url: string): string {
    return String(url || '').split('?')[0].split('#')[0];
  }
}
