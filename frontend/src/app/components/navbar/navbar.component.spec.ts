import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../services/auth.service';
import { AuthServiceStub } from '../../testing/test-doubles';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let auth: AuthServiceStub;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarComponent, BlankComponent],
      providers: [
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'atlas', component: BlankComponent },
          { path: 'events', component: BlankComponent },
          { path: 'admin', component: BlankComponent },
          { path: 'admin/places', component: BlankComponent },
          { path: 'admin/events', component: BlankComponent },
          { path: 'admin/review/places', component: BlankComponent },
          { path: 'admin/review/events', component: BlankComponent },
        ]),
        { provide: AuthService, useClass: AuthServiceStub },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    auth = TestBed.inject(AuthService) as unknown as AuthServiceStub;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  async function goTo(path: string): Promise<void> {
    await router.navigateByUrl(path);
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows Sign in when there is no displayed user', () => {
    expect(fixture.nativeElement.querySelector('#loginBtn')?.textContent).toContain('Sign in');
    expect(fixture.nativeElement.querySelector('#avatar')).toBeNull();
  });

  it('keeps the avatar from displayUser even if user$ is null', () => {
    auth.displayUser.set({
      uid: 'u1',
      email: 'a@b.c',
      photoURL: 'assets/img/avatar.png',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#loginBtn')).toBeNull();
    expect(fixture.nativeElement.querySelector('#avatar')).toBeTruthy();
  });

  it('shows the default avatar when the persisted user has no photo URL', () => {
    auth.displayUser.set({ uid: 'u1', email: 'a@b.c', photoURL: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#loginBtn')).toBeNull();
    const avatar = fixture.nativeElement.querySelector('#avatar') as HTMLImageElement;
    expect(avatar).toBeTruthy();
    expect(avatar.src).toContain('assets/img/avatar.png');
  });

  it('opens the logo site menu on admin catalogue and review pages', async () => {
    await goTo('/admin/places');
    expect(component.isLanding()).toBeFalse();
    expect(fixture.nativeElement.querySelector('#nav-title')?.textContent).toContain('CIRCECO');

    fixture.nativeElement.querySelector('#logo').click();
    fixture.detectChanges();
    const menu = fixture.nativeElement.querySelector('.logo-dropdown');
    expect(menu).toBeTruthy();
    expect(menu.textContent).toContain('Circular Atlas');
    expect(menu.textContent).toContain('Circular Events');

    await goTo('/admin/review/places');
    expect(component.isLanding()).toBeFalse();
    expect(fixture.nativeElement.querySelector('#nav-title')?.textContent).toContain('CIRCECO');
    expect(fixture.nativeElement.querySelector('.logo-dropdown')).toBeNull();

    fixture.nativeElement.querySelector('#logo').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.logo-dropdown')).toBeTruthy();
  });

  it('keeps landing logo click as home, without a site menu', async () => {
    await goTo('/');
    expect(component.isLanding()).toBeTrue();
    fixture.nativeElement.querySelector('#logo').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.logo-dropdown')).toBeNull();
  });
});
