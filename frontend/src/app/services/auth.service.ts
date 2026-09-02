import { Injectable, inject, signal } from '@angular/core';
import {
  Auth, user, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, User
} from '@angular/fire/auth';
import { setPersistence, browserLocalPersistence, getIdTokenResult, sendPasswordResetEmail } from 'firebase/auth';
import { Observable, from, firstValueFrom, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

/** Header-safe user snapshot (survives reload; not a live Firebase User). */
export type DisplayUser = {
  uid: string;
  email: string | null;
  photoURL: string | null;
};

export const DISPLAY_USER_LS_KEY = 'circeco.displayUser';

export function toDisplayUserSnapshot(
  u: { uid: string; email?: string | null; photoURL?: string | null } | null,
): DisplayUser | null {
  if (!u?.uid) return null;
  return {
    uid: String(u.uid),
    email: u.email ?? null,
    photoURL: u.photoURL ?? null,
  };
}

export function readPersistedDisplayUser(): DisplayUser | null {
  try {
    const raw = localStorage.getItem(DISPLAY_USER_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid.trim()) return null;
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      photoURL: typeof parsed.photoURL === 'string' ? parsed.photoURL : null,
    };
  } catch {
    return null;
  }
}

export function writePersistedDisplayUser(u: DisplayUser | null): void {
  try {
    if (!u) localStorage.removeItem(DISPLAY_USER_LS_KEY);
    else localStorage.setItem(DISPLAY_USER_LS_KEY, JSON.stringify(toDisplayUserSnapshot(u)));
  } catch {}
}

/** Keep the last user across transient `null` emissions; clear only after sign-out. */
export function holdUserUntilSignOut<T>(
  displayed: T | null,
  emitted: T | null,
  signedOut: boolean,
): T | null {
  if (emitted) return emitted;
  return signedOut ? null : displayed;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private signedOutIntentionally = false;

  /** Firebase user stream */
  readonly user$: Observable<User | null> = user(this.auth);

  /**
   * Header chrome. Seeded from the live user or last snapshot so a signed-in
   * person never flashes “Sign in” (hydration, navigation, city reload).
   * Cleared only on an intentional sign-out.
   */
  readonly displayUser = signal<DisplayUser | null>(
    toDisplayUserSnapshot(this.auth.currentUser) || readPersistedDisplayUser()
  );

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
        this.applyDisplayUser(toDisplayUserSnapshot(u), this.signedOutIntentionally);
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
    this.displayUser.set(null);
    writePersistedDisplayUser(null);
    return from(signOut(this.auth));
  }

  private applyDisplayUser(emitted: DisplayUser | null, signedOut: boolean) {
    const next = holdUserUntilSignOut(this.displayUser(), emitted, signedOut);
    this.displayUser.set(next);
    if (emitted) writePersistedDisplayUser(emitted);
    else if (signedOut) writePersistedDisplayUser(null);
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
