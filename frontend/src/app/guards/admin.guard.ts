import { DOCUMENT } from '@angular/common';
import { inject, isDevMode } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, switchMap, take } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Observable, from, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environments';

const DEV_BYPASS_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Local `ng serve` may skip the admin claim on loopback only.
 * Production builds (`environment.production` or `!isDevMode()`) always require the claim.
 */
export function allowDevAdminBypass(
  production: boolean,
  devMode: boolean,
  hostname: string
): boolean {
  if (production || !devMode) return false;
  return DEV_BYPASS_HOSTS.has(hostname);
}

/** Resolves after Firebase has finished the initial auth state determination (persisted session, etc.). */
function whenAuthDetermined(auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
}

/**
 * Allows access only when the authenticated user has the `admin` custom claim.
 * Redirects anonymous or non-admin users back to the landing page.
 * Hosted / production builds always check the claim; localhost `ng serve` may bypass.
 */
export const adminGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const auth = inject(Auth);
  const authService = inject(AuthService);
  const router = inject(Router);
  const doc = inject(DOCUMENT);
  const hostname = doc.defaultView?.location?.hostname || doc.location?.hostname || '';

  if (allowDevAdminBypass(environment.production, isDevMode(), hostname)) {
    return of(true);
  }

  // Wait for persisted session restore; otherwise user$ can emit null once and take(1) wrongly denies access.
  return from(whenAuthDetermined(auth)).pipe(
    switchMap(() => authService.isAdmin()),
    take(1),
    map((isAdmin) => (isAdmin ? true : router.createUrlTree(['/'])))
  );
};
