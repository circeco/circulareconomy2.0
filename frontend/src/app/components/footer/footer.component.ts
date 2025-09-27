import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { environment } from '../../../environments/environments';

declare global { interface Window { emailjs?: any; } }

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
})
export class FooterComponent {
  sending = false;
  success: string | null = null;
  error: string | null = null;

  // button animation flags (replaces jQuery buttonCircle)
  anim = { onclic: false, validate: false };

  private ensureEmailJsInit() {
    const ej = window.emailjs;
    if (!ej) throw new Error('EmailJS SDK not loaded');
    try { ej.init?.(environment.emailjs.publicKey); } catch {}
    return ej;
  }

  async onSubmit(form: NgForm) {
    if (!form.valid) return;
    const { name, emailaddress, message } = form.value;

    this.sending = true;
    this.success = null;
    this.error = null;

    // start legacy-like animation
    this.anim.onclic = true;

    try {
      const ej = this.ensureEmailJsInit();
      await ej.send(
        environment.emailjs.serviceId,
        environment.emailjs.templateId,
        {
          from_name: name,
          from_email: emailaddress,
          from_message: message,
        }
      );

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
      this.sending = false;
    }
  }
}
