import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { CityListComponent, cityListPhotoSrc } from './city-list.component';
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

  it('maps stockholm and milan photos by city id', () => {
    expect(cityListPhotoSrc('stockholm')).toBe('assets/cities/stockholm.jpg');
    expect(cityListPhotoSrc('milan')).toBe('assets/cities/milan.jpg');
    expect(cityListPhotoSrc('turin')).toBeNull();
  });

  it('renders a two-column photo-card grid', () => {
    const fixture = TestBed.createComponent(CityListComponent);
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('.city-list-grid') as HTMLElement;
    const cards = fixture.nativeElement.querySelectorAll('.city-card') as NodeListOf<HTMLButtonElement>;
    expect(grid).toBeTruthy();
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute('aria-label')).toBe('Stockholm');
    expect(cards[1].getAttribute('aria-label')).toBe('Milan');
    expect(cards[0].querySelector('.city-card-photo')?.getAttribute('src')).toBe(
      'assets/cities/stockholm.jpg'
    );
    expect(cards[1].querySelector('.city-card-photo')?.getAttribute('src')).toBe(
      'assets/cities/milan.jpg'
    );
    expect(cards[0].classList.contains('selected')).toBeTrue();
    expect(cards[1].classList.contains('selected')).toBeFalse();
  });

  it('selects a city and closes the picker', () => {
    const fixture = TestBed.createComponent(CityListComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.city-card') as NodeListOf<HTMLButtonElement>;
    buttons[1].click();
    expect(cityId()).toBe('milan');
    expect(chrome.cityPickerOpen()).toBeFalse();
  });

  it('closes the picker from the back chevron without changing city', () => {
    const fixture: ComponentFixture<CityListComponent> = TestBed.createComponent(CityListComponent);
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector('.city-list-back') as HTMLButtonElement;
    back.click();
    expect(cityId()).toBe('stockholm');
    expect(chrome.cityPickerOpen()).toBeFalse();
  });
});
