import { Injectable, inject, signal } from '@angular/core';
import {
  Auth, user, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, setPersistence, browserLocalPersistence, User
} from '@angular/fire/auth';
import { Observable, from, firstValueFrom, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { getIdTokenResult } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  /** Firebase user stream */
  readonly user$: Observable<User | null> = user(this.auth);

  /** Simple UI state for the modal */
  readonly modalOpen = signal(false);
  openModal()  { this.modalOpen.set(true); }
  closeModal() { this.modalOpen.set(false); }

  constructor() {
    setPersistence(this.auth, browserLocalPersistence).catch(() => {});
    this.user$.subscribe(u => {
      try {
        window.dispatchEvent(new CustomEvent('favorites:auth', {
          detail: { user: u ? { uid: u.uid, email: u.email ?? null } : null }
        }));
      } catch {}
    });

    const g = window as any;
    g.circeco = g.circeco || {};
    // define (or overwrite) the opener and log when it's called
    g.circeco.openAuthModal = () => {
      console.log('[auth] openAuthModal() called');
      this.openModal();
    };
    console.log('[auth] openAuthModal wired');
  }

  /** Sign in/out/up APIs */
  signIn(email: string, password: string) {
    return from(signInWithEmailAndPassword(this.auth, email, password));
  }
  signUp(email: string, password: string) {
    return from(createUserWithEmailAndPassword(this.auth, email, password));
  }
  signOut() { return from(signOut(this.auth)); }

  /** Helpers for async/await usage from components */
  signInOnce(email: string, password: string) {
    return firstValueFrom(this.signIn(email, password));
  }
  signUpOnce(email: string, password: string) {
    return firstValueFrom(this.signUp(email, password));
  }
  signOutOnce() {
    return firstValueFrom(this.signOut());
  }

  /** Convenience observable that resolves to true when a user is logged in. */
  isAuthenticated() {
    return this.user$.pipe(map(user => !!user));
  }

  /**
   * Checks whether the current user has the `admin` custom claim.
   * Returns false when anonymous or when the claim is missing.
   */
  isAdmin() {
    return this.user$.pipe(
      takeUntilDestroyed(),
      switchMap(user => {
        if (!user) return of(false);
        return from(getIdTokenResult(user)).pipe(map(token => !!token.claims['admin']));
      })
    );
  }
}

