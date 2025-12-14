import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
  let authStub: { user$: any };

  beforeEach(() => {
    authStub = { user$: of(null) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authStub },
        provideRouter([])
      ]
    });
  });

  it('allows navigation when a user exists', async () => {
    authStub.user$ = of({ uid: '123' });
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(authGuard({} as any, {} as any) as any)
    );
    expect(result).toBeTrue();
  });

  it('redirects to landing when no user is present', async () => {
    authStub.user$ = of(null);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(authGuard({} as any, {} as any) as any)
    );
    expect(result instanceof UrlTree).toBeTrue();
  });
});
