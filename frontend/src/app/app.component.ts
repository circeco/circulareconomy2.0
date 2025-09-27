import { Component, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule, NgIf, AsyncPipe } from '@angular/common';
// import { RouterOutlet } from '@angular/router';

import { LegacyLoaderService } from './legacy-loader.service';
import { AuthService } from './services/auth.service';
import { FavoritesService } from './services/favorites.service';
import { LoginComponent } from './components/login/login.component';
import { MapComponent } from './components/map/map.component';
import { NavbarComponent } from './components/navbar/navbar.component';

declare global {
  interface Window {
    myFunction?: () => void;
    sendMail?: (form: HTMLFormElement) => boolean;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NavbarComponent, MapComponent, LoginComponent, NgIf, AsyncPipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit {
  constructor(
    private legacy: LegacyLoaderService,
    private zone: NgZone,
    public auth: AuthService,   // Injecting this ensures the service constructor runs (global bridge, Firestore listener, map sync)
    private _favorites: FavoritesService
  ) {}

  /** Use a getter so we don’t access this.auth during field initialization */
  get user$() {
    return this.auth.user$;
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(async () => {
      try {
        console.log('[legacy] loading…');
        await this.legacy.loadAll();
        console.log('[legacy] loaded.');
      } catch (e) {
        console.error('[legacy] failed:', e);
      }
    });
  }

  // Legacy hooks still in use
  onHamburger() { window.myFunction?.(); }

  onContactSubmit(e: Event) {
    const form = e.target as HTMLFormElement;
    const ok = window.sendMail ? window.sendMail(form) : true;
    if (!ok) e.preventDefault();
  }

  // Angular auth controls
  openLogin() { this.auth.openModal(); }
  async logout() { await this.auth.signOutOnce(); }
}
