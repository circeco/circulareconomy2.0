import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environments';

/**
 * Allows access only when the authenticated user has the `admin` custom claim.
 * Redirects anonymous or non-admin users back to the landing page.
 */
export const adminGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Option A: local development bypass.
  // This allows you to use admin pages locally without managing custom claims.
  // Production builds and non-local hosts remain protected by the admin claim.
  const isLocalhost =
    !environment.production &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isLocalhost) return of(true);

  return authService.isAdmin().pipe(
    take(1),
    map(isAdmin => isAdmin ? true : router.createUrlTree(['/']))
  );
};
