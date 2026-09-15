import { Injectable, signal } from '@angular/core';

/** Width at which the current desktop layout starts. Below this: phone chrome. */
export const DESKTOP_MIN_WIDTH = 1024;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  readonly isPhone = signal(false);
  private pinningScroll = false;

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
    this.bindVisualViewport();
  }

  /** Keep phone layout flush left when the soft keyboard / visualViewport pans. */
  pinHorizontal(): void {
    this.syncVisualViewport();
  }

  private apply(isPhone: boolean): void {
    this.isPhone.set(isPhone);
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('layout-phone', isPhone);
    document.documentElement.classList.toggle('layout-desktop', !isPhone);
    document.body.classList.toggle('layout-phone', isPhone);
    document.body.classList.toggle('layout-desktop', !isPhone);
    this.syncVisualViewport();
  }

  private bindVisualViewport(): void {
    const onChange = () => this.syncVisualViewport();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
    }
    window.addEventListener('scroll', onChange, { passive: true });
    this.syncVisualViewport();
  }

  private syncVisualViewport(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!this.isPhone()) {
      root.style.removeProperty('--vv-width');
      return;
    }
    if (vv) {
      root.style.setProperty(
        '--vv-width',
        `${Math.max(0, Math.round(Math.min(vv.width, window.innerWidth)))}px`
      );
    }
    if (this.pinningScroll) return;
    const offsetLeft = vv?.offsetLeft ?? 0;
    if (window.scrollX !== 0 || Math.abs(offsetLeft) > 0.5) {
      this.pinningScroll = true;
      window.scrollTo(0, window.scrollY);
      this.pinningScroll = false;
    }
  }
}
