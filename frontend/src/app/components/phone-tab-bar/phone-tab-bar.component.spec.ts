import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { PhoneTabBarComponent } from './phone-tab-bar.component';
import { AuthService } from '../../services/auth.service';
import { AuthServiceStub } from '../../testing/test-doubles';
import { CLEAR_FOCUS_QUERY_PARAMS } from '../../utils/clear-focus-query-params';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('PhoneTabBarComponent', () => {
  let fixture: ComponentFixture<PhoneTabBarComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhoneTabBarComponent, BlankComponent],
      providers: [
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'atlas', component: BlankComponent },
          { path: 'events', component: BlankComponent },
          { path: 'account', component: BlankComponent },
        ]),
        { provide: AuthService, useClass: AuthServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PhoneTabBarComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('exposes clear-focus params so tab merges drop stale place and event', () => {
    expect(fixture.componentInstance.clearFocusQueryParams).toEqual(CLEAR_FOCUS_QUERY_PARAMS);
  });

  it('drops place when switching to Atlas while keeping city', async () => {
    await router.navigateByUrl('/?city=milan&place=four-vintage');
    fixture.detectChanges();
    const atlas = fixture.nativeElement.querySelector('a[aria-label="Circular Atlas"]') as HTMLAnchorElement;
    atlas.click();
    await fixture.whenStable();
    expect(router.url.startsWith('/atlas')).toBeTrue();
    expect(router.url).toContain('city=milan');
    expect(router.url).not.toContain('place=');
  });
});
