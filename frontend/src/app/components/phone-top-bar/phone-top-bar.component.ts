import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { PhoneChromeService } from '../../services/phone-chrome.service';

@Component({
  selector: 'app-phone-top-bar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './phone-top-bar.component.html',
  styleUrls: ['./phone-top-bar.component.scss'],
})
export class PhoneTopBarComponent {
  private router = inject(Router);
  private cities = inject(CitiesService);
  readonly cityContext = inject(CityContextService);
  readonly chrome = inject(PhoneChromeService);

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.pathOf(this.router.url)),
      startWith(this.pathOf(this.router.url))
    ),
    { initialValue: this.pathOf(this.router.url) }
  );

  readonly isAccount = computed(() => this.path().startsWith('/account'));
  readonly isAtlas = computed(() => this.path().startsWith('/atlas'));
  readonly isEvents = computed(() => this.path().startsWith('/events'));
  readonly showCity = computed(() => !this.isAccount());
  readonly showHeart = computed(() => this.isAtlas() || this.isEvents());
  readonly savedOn = computed(() =>
    this.isAtlas() ? this.chrome.atlasFavoritesOn() : this.chrome.eventsFavoritesOn()
  );

  readonly cityLabel = computed(() => {
    const id = this.cityContext.cityId();
    const fromList = this.cities.list().find((c) => c.id === id)?.name;
    if (fromList) return fromList;
    return this.cityContext.cityName() || id;
  });

  openCity(): void {
    this.chrome.openCityPicker();
  }

  onHeart(): void {
    if (this.isAtlas()) this.chrome.toggleSaved('atlas');
    else if (this.isEvents()) this.chrome.toggleSaved('events');
  }

  private pathOf(url: string): string {
    return String(url || '').split('?')[0].split('#')[0];
  }
}
