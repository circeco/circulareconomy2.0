// src/app/components/login/login.component.ts
import { Component, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
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
  loading = signal(false);
  error = signal<string | null>(null);
  notice = signal<string | null>(null);
  submittedSignIn = signal(false);
  submittedSignUp = signal(false);

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
        untracked(() => this.resetForms());
      }
    }, { allowSignalWrites: true });
  }

  closeByBackdrop(ev: MouseEvent) {
    if ((ev.target as HTMLElement).classList.contains('auth-modal')) this.auth.closeModal();
  }

  showSignUp(): void {
    this.flipping.set(true);
    this.clearFeedback();
    this.submittedSignUp.set(false);
  }

  showSignIn(): void {
    this.flipping.set(false);
    this.clearFeedback();
    this.submittedSignIn.set(false);
  }

  fieldInvalid(form: FormGroup, name: string, submitted: boolean): boolean {
    const control = form.get(name);
    return !!control && control.invalid && (control.touched || submitted);
  }

  /** Clear email via the custom × (hides native browser clear buttons in CSS). */
  clearEmail(form: FormGroup): void {
    const control = form.get('email');
    if (!control) return;
    control.setValue('');
    control.markAsDirty();
    control.markAsTouched();
    control.updateValueAndValidity();
  }

  fieldError(form: FormGroup, name: 'email' | 'password', mode: 'signin' | 'signup'): string {
    const control = form.get(name);
    if (!control || !control.errors) return '';
    if (name === 'email') {
      if (control.errors['required']) return 'Please enter your email.';
      if (control.errors['email']) return 'Please enter a valid email address.';
    }
    if (name === 'password') {
      if (control.errors['required']) return 'Please enter your password.';
      if (control.errors['minlength'] && mode === 'signup') {
        return 'Password should be at least 6 characters.';
      }
    }
    return '';
  }

  async doSignIn() {
    this.submittedSignIn.set(true);
    this.notice.set(null);
    this.signInForm.markAllAsTouched();

    if (this.signInForm.invalid) {
      this.error.set(this.summaryError(this.signInForm, 'signin'));
      return;
    }

    const { email, password } = this.signInForm.value;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.signInOnce(email!, password!);
      this.auth.closeModal();
    } catch (err: any) {
      this.error.set(this.human(err?.code, err?.message));
    } finally {
      this.loading.set(false);
    }
  }

  async doSignUp() {
    this.submittedSignUp.set(true);
    this.notice.set(null);
    this.signUpForm.markAllAsTouched();

    if (this.signUpForm.invalid) {
      this.error.set(this.summaryError(this.signUpForm, 'signup'));
      return;
    }

    const { email, password } = this.signUpForm.value;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.signUpOnce(email!, password!);
      this.auth.closeModal();
    } catch (err: any) {
      this.error.set(this.human(err?.code, err?.message));
    } finally {
      this.loading.set(false);
    }
  }

  async doForgotPassword() {
    this.submittedSignIn.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.signInForm.controls.email.markAsTouched();

    const email = this.signInForm.controls.email.value?.trim() || '';
    if (!email) {
      this.error.set('Enter your email first, then click Forgot password.');
      return;
    }
    if (this.signInForm.controls.email.invalid) {
      this.error.set('Please enter a valid email address.');
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.resetPasswordOnce(email);
      this.notice.set('Password reset email sent. Check your inbox.');
    } catch (err: any) {
      this.error.set(this.human(err?.code, err?.message));
    } finally {
      this.loading.set(false);
    }
  }

  private summaryError(form: FormGroup, mode: 'signin' | 'signup'): string {
    const email = form.get('email');
    const password = form.get('password');
    const missingEmail = !!email?.errors?.['required'];
    const badEmail = !!email?.errors?.['email'];
    const missingPassword = !!password?.errors?.['required'];
    const shortPassword = !!password?.errors?.['minlength'];

    if (missingEmail && missingPassword) return 'Please fill in your email and password.';
    if (missingEmail) return 'Please enter your email.';
    if (badEmail) return 'Please enter a valid email address.';
    if (missingPassword) return 'Please enter your password.';
    if (shortPassword && mode === 'signup') return 'Password should be at least 6 characters.';
    return 'Please check the highlighted fields.';
  }

  private resetForms(): void {
    this.flipping.set(false);
    this.clearFeedback();
    this.loading.set(false);
    this.submittedSignIn.set(false);
    this.submittedSignUp.set(false);
    this.signInForm.reset();
    this.signUpForm.reset();
  }

  private clearFeedback(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private human(code?: string, fallback?: string): string {
    switch (code) {
      case 'auth/user-not-found':
        return 'No account found. Create one on the other tab.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Wrong email or password. Try again.';
      case 'auth/email-already-in-use':
        return 'Email already in use. Please sign in.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait and try again.';
      default:
        return fallback || 'Something went wrong. Please try again.';
    }
  }
}
