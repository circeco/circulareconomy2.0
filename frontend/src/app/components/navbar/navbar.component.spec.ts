import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../services/auth.service';
import { AuthServiceStub } from '../../testing/test-doubles';

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let auth: AuthServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: AuthServiceStub },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    auth = TestBed.inject(AuthService) as unknown as AuthServiceStub;
    fixture.detectChanges();
  });

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
});
