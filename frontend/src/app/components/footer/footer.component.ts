import { AfterViewInit, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { environment } from '../../../environments/environments';

declare global { interface Window { grecaptcha?: any; } }

@Component({
  selector: 'contact-footer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
})
export class FooterComponent implements AfterViewInit {
  sending = false;
  success: string | null = null;
  error: string | null = null;
  recaptchaSiteKey = environment.formspree?.recaptchaSiteKey ?? '';

  // button animation flags (replaces jQuery buttonCircle)
  anim = { onclic: false, validate: false };

  ngAfterViewInit() {
    if (!this.recaptchaSiteKey) return;
    if (document.getElementById('recaptcha-script')) return;
    const script = document.createElement('script');
    script.id = 'recaptcha-script';
    script.src = 'https://www.google.com/recaptcha/api.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }

  async onSubmit(form: NgForm) {
    if (!form.valid) return;
    const { name, emailaddress, message, _gotcha } = form.value;
    if (_gotcha) return;

    const endpoint = environment.formspree?.endpoint;
    this.success = null;
    this.error = null;
    if (!endpoint) {
      this.error = 'Contact form is not configured yet.';
      return;
    }

    this.sending = true;

    // start legacy-like animation
    this.anim.onclic = true;

    try {
      let recaptchaToken: string | null = null;
      if (this.recaptchaSiteKey) {
        recaptchaToken = window.grecaptcha?.getResponse?.() || null;
        if (!recaptchaToken) {
          throw new Error('Please confirm you are not a robot.');
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email: emailaddress,
          message,
          _replyto: emailaddress,
          ...(recaptchaToken ? { 'g-recaptcha-response': recaptchaToken } : {}),
        }),
      });

      if (!response.ok) {
        let message = 'Sending failed. Please try again.';
        try {
          const data = await response.json();
          if (data?.errors?.length) {
            message = data.errors.map((err: { message?: string }) => err.message).filter(Boolean).join(' ');
          }
        } catch {
          // ignore parse failures and use default message
        }
        throw new Error(message);
      }

      // success animation sequence (mimic timings from buttonCircle)
      setTimeout(() => {
        this.anim.onclic = false;
        this.anim.validate = true;
        setTimeout(() => (this.anim.validate = false), 1250);
      }, 2250);

      this.success = 'Thanks! Your message has been sent.';
      form.resetForm();
    } catch (e: any) {
      this.anim.onclic = false;
      this.anim.validate = false;
      this.error = e?.message || 'Sending failed. Please try again.';
      console.error('[contact] send failed', e);
    } finally {
      if (this.recaptchaSiteKey) {
        window.grecaptcha?.reset?.();
      }
      this.sending = false;
    }
  }
}
