import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss']
})
export class AccountComponent {
  readonly auth = inject(AuthService);
  readonly geo = inject(GeolocationService);

  panel = signal<'email' | 'password' | 'delete' | null>(null);
  currentPassword = '';
  newEmail = '';
  newPassword = '';
  error = signal('');
  notice = signal('');
  loading = signal(false);

  readonly email = computed(() => this.auth.displayUser()?.email || '');
  readonly displayName = computed(() => {
    const mail = this.email();
    const local = mail.split('@')[0] || 'Circeco';
    return local.replace(/[._-]+/g, ' ');
  });
  readonly initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '');
    return letters.join('') || 'C';
  });

  toggleLocation(on: boolean): void {
    this.geo.setUseMyLocation(on);
  }

  openPanel(name: 'email' | 'password' | 'delete'): void {
    this.panel.set(this.panel() === name ? null : name);
    this.error.set('');
    this.notice.set('');
    this.currentPassword = '';
    this.newEmail = '';
    this.newPassword = '';
  }

  async saveEmail(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.updateEmailOnce(this.newEmail, this.currentPassword);
      this.notice.set('Email updated.');
      this.panel.set(null);
    } catch (e: any) {
      this.error.set(e?.message || 'Could not update email.');
    } finally {
      this.loading.set(false);
    }
  }

  async savePassword(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.updatePasswordOnce(this.currentPassword, this.newPassword);
      this.notice.set('Password updated.');
      this.panel.set(null);
    } catch (e: any) {
      this.error.set(e?.message || 'Could not update password.');
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.signOutOnce();
    window.location.assign('/');
  }

  async deleteAccount(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.deleteAccountOnce(this.currentPassword);
      window.location.assign('/');
    } catch (e: any) {
      this.error.set(e?.message || 'Could not delete account.');
      this.loading.set(false);
    }
  }
}
