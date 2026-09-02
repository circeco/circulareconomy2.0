import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { CitySwitcherComponent } from './city-switcher.component';
import { CitiesService } from '../../services/cities.service';
import { CityContextService } from '../../services/city-context.service';

describe('CitySwitcherComponent', () => {
  const cities = signal<{ id: string; name: string }[]>([]);
  const cityName = signal('');

  beforeEach(async () => {
    cities.set([]);
    cityName.set('');
    await TestBed.configureTestingModule({
      imports: [CitySwitcherComponent],
      providers: [
        provideRouter([]),
        {
          provide: CitiesService,
          useValue: { cities$: of([]), list: cities.asReadonly() },
        },
        {
          provide: CityContextService,
          useValue: {
            cityId: signal('stockholm'),
            cityId$: of('stockholm'),
            cityName,
            setCityId: () => {},
            rememberCityName: (name: string) => cityName.set(name),
          },
        },
      ],
    }).compileComponents();
  });

  function createInline(): ComponentFixture<CitySwitcherComponent> {
    const fixture = TestBed.createComponent(CitySwitcherComponent);
    fixture.componentRef.setInput('variant', 'inline');
    fixture.detectChanges();
    return fixture;
  }

  it('shows Loading cities only before any list has arrived', () => {
    const fixture = createInline();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.textContent).toContain('Loading cities…');
  });

  it('keeps city names when a list is already cached', () => {
    cities.set([
      { id: 'stockholm', name: 'Stockholm' },
      { id: 'milan', name: 'Milan' },
    ]);
    const fixture = createInline();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.textContent).toContain('Stockholm');
    expect(select.textContent).toContain('Milan');
    expect(select.textContent).not.toContain('Loading cities…');
  });

  it('shows the last city name instead of Loading cities when the list has not arrived', () => {
    cityName.set('Stockholm');
    const fixture = createInline();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.textContent).toContain('Stockholm');
    expect(select.textContent).not.toContain('Loading cities…');
  });

  it('remembers the selected city name for the next load', () => {
    cities.set([
      { id: 'stockholm', name: 'Stockholm' },
      { id: 'milan', name: 'Milan' },
    ]);
    const fixture = createInline();
    fixture.componentInstance.onCityIdChange('milan');
    expect(cityName()).toBe('Milan');
  });
});
