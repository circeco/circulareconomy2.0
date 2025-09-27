// src/app/components/login/login.component.ts
import { Component, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  flipping = signal(false);
  loading  = signal(false);
  error    = signal<string | null>(null);

  signInForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  signUpForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor() {
    // Reset to Sign in whenever modal opens
    effect(() => {
      if (this.auth.modalOpen()) {
        untracked(() => {
          this.flipping.set(false);
          this.error.set(null);
          this.loading.set(false);
        });
      }
    }, { allowSignalWrites: true });
  }

  closeByBackdrop(ev: MouseEvent) {
    if ((ev.target as HTMLElement).classList.contains('auth-modal')) this.auth.closeModal();
  }

  async doSignIn() {
    if (this.signInForm.invalid) return;
    const { email, password } = this.signInForm.value;
    this.loading.set(true); this.error.set(null);
    try { await this.auth.signInOnce(email!, password!); this.auth.closeModal(); }
    catch (err: any) { this.error.set(this.human(err?.code, err?.message)); }
    finally { this.loading.set(false); }
  }

  async doSignUp() {
    if (this.signUpForm.invalid) return;
    const { email, password } = this.signUpForm.value;
    this.loading.set(true); this.error.set(null);
    try { await this.auth.signUpOnce(email!, password!); this.auth.closeModal(); }
    catch (err: any) { this.error.set(this.human(err?.code, err?.message)); }
    finally { this.loading.set(false); }
  }

  private human(code?: string, fallback?: string): string {
    switch (code) {
      case 'auth/user-not-found': return 'No account found. Create one on the other tab.';
      case 'auth/wrong-password': return 'Wrong password. Try again.';
      case 'auth/email-already-in-use': return 'Email already in use. Please sign in.';
      case 'auth/weak-password': return 'Password should be at least 6 characters.';
      default: return fallback || 'Something went wrong. Please try again.';
    }
  }
}
