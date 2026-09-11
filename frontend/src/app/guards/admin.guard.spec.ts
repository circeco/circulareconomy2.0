import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { FirebaseApp, deleteApp, getApps, initializeApp } from 'firebase/app';
import { Auth as FirebaseAuth, getAuth } from 'firebase/auth';

import { adminGuard, allowDevAdminBypass } from './admin.guard';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environments';

describe('allowDevAdminBypass', () => {
  it('never bypasses production builds, even on localhost', () => {
    expect(allowDevAdminBypass(true, true, 'localhost')).toBeFalse();
    expect(allowDevAdminBypass(true, false, 'localhost')).toBeFalse();
  });

  it('never bypasses when Angular is not in dev mode (hosted build)', () => {
    expect(allowDevAdminBypass(false, false, 'localhost')).toBeFalse();
    expect(allowDevAdminBypass(false, false, '127.0.0.1')).toBeFalse();
  });

  it('bypasses only loopback hosts during local ng serve', () => {
    expect(allowDevAdminBypass(false, true, 'localhost')).toBeTrue();
    expect(allowDevAdminBypass(false, true, '127.0.0.1')).toBeTrue();
  });

  it('does not bypass non-loopback hosts during local ng serve', () => {
    expect(allowDevAdminBypass(false, true, 'circeco.app')).toBeFalse();
    expect(allowDevAdminBypass(false, true, '192.168.1.10')).toBeFalse();
    expect(allowDevAdminBypass(false, true, '')).toBeFalse();
  });
});

describe('adminGuard', () => {
  let authStub: { isAdmin: () => any };
  let previousProduction = false;
  let app: FirebaseApp;
  let auth: FirebaseAuth;

  beforeAll(() => {
    const existing = getApps().find((a) => a.name === 'admin-guard-spec');
    app = existing ?? initializeApp(environment.firebase, 'admin-guard-spec');
    auth = getAuth(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function configure(hostname: string, production: boolean) {
    previousProduction = environment.production;
    (environment as { production: boolean }).production = production;
    authStub = { isAdmin: () => of(false) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authStub },
        { provide: Auth, useValue: auth },
        {
          provide: DOCUMENT,
          useValue: {
            location: { hostname },
            defaultView: { location: { hostname } },
          },
        },
        provideRouter([]),
      ],
    });
  }

  afterEach(() => {
    (environment as { production: boolean }).production = previousProduction;
    TestBed.resetTestingModule();
  });

  it('allows navigation when the admin claim is present', async () => {
    configure('circeco.app', true);
    authStub.isAdmin = () => of(true);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result).toBeTrue();
  });

  it('redirects non-admin users in production mode', async () => {
    configure('localhost', true);
    authStub.isAdmin = () => of(false);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result instanceof UrlTree).toBeTrue();
  });

  it('bypasses the claim on localhost when production is false (ng serve)', async () => {
    configure('localhost', false);
    authStub.isAdmin = () => of(false);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result).toBeTrue();
  });

  it('bypasses the claim on 127.0.0.1 when production is false', async () => {
    configure('127.0.0.1', false);
    authStub.isAdmin = () => of(false);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result).toBeTrue();
  });

  it('still requires the claim on a non-loopback host when production is false', async () => {
    configure('192.168.1.10', false);
    authStub.isAdmin = () => of(false);
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(adminGuard({} as any, {} as any) as any)
    );
    expect(result instanceof UrlTree).toBeTrue();
  });
});
