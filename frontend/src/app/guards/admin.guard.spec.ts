import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import * as firebaseAuth from 'firebase/auth';
import { Auth } from '@angular/fire/auth';

import { adminGuard } from './admin.guard';
import { AuthService } from '../services/auth.service';

describe('adminGuard', () => {
  let authStub: { isAdmin: () => any };

  beforeEach(() => {
    authStub = { isAdmin: () => of(false) };
    spyOnProperty(window, 'location', 'get').and.returnValue({
      hostname: 'example.com',
      pathname: '/',
      href: 'https://example.com/',
      search: '',
      hash: '',
    } as Location);
    spyOn(firebaseAuth, 'onAuthStateChanged').and.callFake(
      (_auth, next: (user: firebaseAuth.User | null) => void) => {
        next(null);
        return () => {};
      }
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authStub },
        { provide: Auth, useValue: {} },
        provideRouter([])
      ]
    });
  });

  it('allows navigation when the admin claim is present', async () => {
    authStub.isAdmin = () => of(true);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result).toBeTrue();
  });

  it('redirects non-admin users', async () => {
    authStub.isAdmin = () => of(false);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result instanceof UrlTree).toBeTrue();
  });
});
