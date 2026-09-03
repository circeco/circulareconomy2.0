import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CitiesService } from '../../services/cities.service';
import { CityContextService } from '../../services/city-context.service';
import { PhoneChromeService } from '../../services/phone-chrome.service';

@Component({
  selector: 'app-city-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './city-list.component.html',
  styleUrls: ['./city-list.component.scss'],
})
export class CityListComponent {
  private cities = inject(CitiesService);
  readonly cityContext = inject(CityContextService);
  readonly chrome = inject(PhoneChromeService);

  readonly rows = computed(() => this.cities.list());

  select(id: string, name: string): void {
    this.cityContext.setCityId(id);
    if (name) this.cityContext.rememberCityName(name);
    this.chrome.closeCityPicker();
  }

  back(): void {
    this.chrome.closeCityPicker();
  }
}
