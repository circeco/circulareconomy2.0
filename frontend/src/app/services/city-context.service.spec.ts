import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { CityContextService } from './city-context.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('CityContextService focus params', () => {
  beforeEach(() => {
    try { localStorage.removeItem('circeco.cityId'); } catch {}
    try { localStorage.removeItem('circeco.cityName'); } catch {}
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'atlas', component: BlankComponent },
        ]),
      ],
    });
  });

  afterEach(() => {
    try { localStorage.removeItem('circeco.cityId'); } catch {}
    try { localStorage.removeItem('circeco.cityName'); } catch {}
  });

  it('drops place and event when the city query param changes', async () => {
    const router = TestBed.inject(Router);
    const ctx = TestBed.inject(CityContextService);
    await router.navigateByUrl('/atlas?city=milan&place=four-vintage&event=e1');
    ctx.setCityId('stockholm');
    expect(router.url).toContain('/atlas');
    expect(router.url).toContain('city=stockholm');
    expect(router.url).not.toContain('place=');
    expect(router.url).not.toContain('event=');
  });

  it('keeps an intentional place when only adding missing city to the URL', async () => {
    const router = TestBed.inject(Router);
    TestBed.inject(CityContextService);
    await router.navigateByUrl('/atlas?place=four-vintage');
    expect(router.url).toContain('place=four-vintage');
    expect(router.url).toMatch(/[?&]city=/);
  });
});
