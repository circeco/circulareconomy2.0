import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, switchMap, take } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Observable, from, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environments';

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
 */
export const adminGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const auth = inject(Auth);
  const authService = inject(AuthService);
  const router = inject(Router);

  // In development, always allow admin routes (Firestore rules still enforce admin claim for data).
  if (!environment.production) return of(true);

  // Wait for persisted session restore; otherwise user$ can emit null once and take(1) wrongly denies access.
  return from(whenAuthDetermined(auth)).pipe(
    switchMap(() => authService.isAdmin()),
    take(1),
    map((isAdmin) => (isAdmin ? true : router.createUrlTree(['/'])))
  );
};
