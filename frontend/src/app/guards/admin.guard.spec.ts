import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { adminGuard } from './admin.guard';
import { AuthService } from '../services/auth.service';

describe('adminGuard', () => {
  let authStub: { isAdmin: () => any };

  beforeEach(() => {
    authStub = { isAdmin: () => of(false) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authStub },
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
