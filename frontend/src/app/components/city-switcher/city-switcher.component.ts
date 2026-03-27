import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AsyncPipe, NgIf } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';

import { CitiesService } from '../../services/cities.service';
import { CityContextService } from '../../services/city-context.service';

@Component({
  selector: 'app-city-switcher',
  standalone: true,
  imports: [CommonModule, NgIf, AsyncPipe, FormsModule],
  templateUrl: './city-switcher.component.html',
  styleUrls: ['./city-switcher.component.scss'],
})
export class CitySwitcherComponent {
  private router = inject(Router);
  private currentPath = signal<string>(this.pathOf(this.router.url));

  /** 'floating' (default) or 'inline' */
  readonly variant = input<'floating' | 'inline'>('floating');

  constructor(
    public cities: CitiesService,
    public cityContext: CityContextService
  ) {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.currentPath.set(this.pathOf(this.router.url)));
  }

  readonly visible = computed(() => {
    const isLanding = this.currentPath() === '/' || this.currentPath() === '';
    if (this.variant() === 'inline') return isLanding;
    return !isLanding; // floating on all non-landing pages (atlas/events/admin/etc.)
  });

  private pathOf(url: string): string {
    return String(url || '').split('?')[0].split('#')[0];
  }

  onCitySelect(ev: Event): void {
    const id = (ev.target as HTMLSelectElement | null)?.value ?? '';
    this.cityContext.setCityId(id);
  }
}

