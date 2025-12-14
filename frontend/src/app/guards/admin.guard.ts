import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Observable } from 'rxjs';

/**
 * Allows access only when the authenticated user has the `admin` custom claim.
 * Redirects anonymous or non-admin users back to the landing page.
 */
export const adminGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAdmin().pipe(
    take(1),
    map(isAdmin => isAdmin ? true : router.createUrlTree(['/']))
  );
};
