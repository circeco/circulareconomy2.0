import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './services/auth.service';
import { EventFavoritesService } from './services/event-favorites.service';
import { FavoritesService } from './services/favorites.service';
import { LoginComponent } from './components/login/login.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { CitySwitcherComponent } from './components/city-switcher/city-switcher.component';

declare global {
  interface Window {
    myFunction?: () => void;
    sendMail?: (form: HTMLFormElement) => boolean;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, NavbarComponent, LoginComponent, CitySwitcherComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  constructor(
    public auth: AuthService,          // ensure auth initializes
    private _favorites: FavoritesService, // ensure favorites initializes
    private _eventFavorites: EventFavoritesService // ensure event favs follow auth
  ) {}

  // Angular auth controls
  openLogin() { this.auth.openModal(); }
  async logout() { await this.auth.signOutOnce(); }
}

