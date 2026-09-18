import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountComponent } from './account.component';
import { AuthService } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';
import { ViewportService } from '../../services/viewport.service';
import { AuthServiceStub } from '../../testing/test-doubles';

describe('AccountComponent', () => {
  let component: AccountComponent;
  let fixture: ComponentFixture<AccountComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: AuthServiceStub },
        GeolocationService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the location toggle', () => {
    const label = fixture.nativeElement.textContent as string;
    expect(label).toContain('Use my location');
  });

  it('links to the privacy policy', () => {
    const link = fixture.nativeElement.querySelector('a[href="/privacy"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Privacy and terms');
  });

  it('lets the user change credentials and delete the account', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Change email address');
    expect(text).toContain('Change password');
    expect(text).toContain('Delete account');
  });

  it('uses Manage your account as the desktop heading', () => {
    TestBed.inject(ViewportService).isPhone.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Manage your account');
  });
});
