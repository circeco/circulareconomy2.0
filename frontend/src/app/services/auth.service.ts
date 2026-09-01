import { Injectable, inject, signal } from '@angular/core';
import {
  Auth, user, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, User
} from '@angular/fire/auth';
import { setPersistence, browserLocalPersistence, getIdTokenResult, sendPasswordResetEmail } from 'firebase/auth';
import { Observable, from, firstValueFrom, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

/** Keep the last user across transient `null` emissions; clear only after sign-out. */
export function holdUserUntilSignOut(
  displayed: User | null,
  emitted: User | null,
  signedOut: boolean,
): User | null {
  if (emitted) return emitted;
  return signedOut ? null : displayed;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private signedOutIntentionally = false;

  /** Firebase user stream */
  readonly user$: Observable<User | null> = user(this.auth);

  /** Header chrome: last known user, not cleared by a brief `user$` null. */
  readonly displayUser = signal<User | null>(null);

  /** Simple UI state for the modal */
  readonly modalOpen = signal(false);
  openModal()  { this.modalOpen.set(true); }
  closeModal() { this.modalOpen.set(false); }

  constructor() {
    setPersistence(this.auth, browserLocalPersistence).catch(err => {
      console.error('[auth] Failed to set persistence', err);
    });
    this.user$.subscribe(u => {
        window.dispatchEvent(new CustomEvent('favorites:auth', {
          detail: { user: u ? { uid: u.uid, email: u.email ?? null } : null }
        }));
        if (u) this.signedOutIntentionally = false;
        this.displayUser.set(
          holdUserUntilSignOut(this.displayUser(), u, this.signedOutIntentionally)
        );
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
  signOut() {
    this.signedOutIntentionally = true;
    return from(signOut(this.auth));
  }
  resetPassword(email: string) {
    return from(sendPasswordResetEmail(this.auth, email));
  }

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
  resetPasswordOnce(email: string) {
    return firstValueFrom(this.resetPassword(email));
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
      switchMap((user) => {
        if (!user) return of(false);
        return from(getIdTokenResult(user)).pipe(map((token) => !!token.claims['admin']));
      })
    );
  }
}
