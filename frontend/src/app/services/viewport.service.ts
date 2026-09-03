import { Injectable, signal } from '@angular/core';

/** Width at which the current desktop layout starts. Below this: phone chrome. */
export const DESKTOP_MIN_WIDTH = 1024;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  readonly isPhone = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`);
    this.apply(mq.matches);
    const onChange = (event: MediaQueryListEvent) => this.apply(event.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
    } else {
      mq.addListener(onChange);
    }
  }

  private apply(isPhone: boolean): void {
    this.isPhone.set(isPhone);
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('layout-phone', isPhone);
    document.body.classList.toggle('layout-desktop', !isPhone);
  }
}
