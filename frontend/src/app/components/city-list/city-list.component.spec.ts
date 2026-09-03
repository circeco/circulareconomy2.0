import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { CityListComponent } from './city-list.component';
import { CitiesService } from '../../services/cities.service';
import { CityContextService } from '../../services/city-context.service';
import { PhoneChromeService } from '../../services/phone-chrome.service';

describe('CityListComponent', () => {
  const cityId = signal('stockholm');
  const cities = signal([
    { id: 'stockholm', name: 'Stockholm' },
    { id: 'milan', name: 'Milan' },
  ]);
  let chrome: PhoneChromeService;

  beforeEach(async () => {
    chrome = new PhoneChromeService();
    chrome.openCityPicker();
    await TestBed.configureTestingModule({
      imports: [CityListComponent],
      providers: [
        provideRouter([]),
        { provide: CitiesService, useValue: { list: cities.asReadonly() } },
        {
          provide: CityContextService,
          useValue: {
            cityId,
            setCityId: (id: string) => cityId.set(id),
            rememberCityName: () => {},
          },
        },
        { provide: PhoneChromeService, useValue: chrome },
      ],
    }).compileComponents();
  });

  it('selects a city and closes the picker', () => {
    const fixture = TestBed.createComponent(CityListComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.city-list-row') as NodeListOf<HTMLButtonElement>;
    buttons[1].click();
    expect(cityId()).toBe('milan');
    expect(chrome.cityPickerOpen()).toBeFalse();
  });
});
