import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { FirebaseApp, deleteApp, getApps, initializeApp } from 'firebase/app';
import { Auth as FirebaseAuth, getAuth } from 'firebase/auth';

import { adminGuard } from './admin.guard';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environments';

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

  beforeEach(() => {
    previousProduction = environment.production;
    (environment as { production: boolean }).production = true;
    authStub = { isAdmin: () => of(false) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authStub },
        { provide: Auth, useValue: auth },
        provideRouter([])
      ]
    });
  });

  afterEach(() => {
    (environment as { production: boolean }).production = previousProduction;
  });

  afterAll(async () => {
    await deleteApp(app);
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
