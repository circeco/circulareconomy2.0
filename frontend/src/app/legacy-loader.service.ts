import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LegacyLoaderService {
  private injected = new Set<string>();
  private running = false;

  /** Build absolute URL for both CDN and local asset paths */
  private toUrl(path: string): string {
    // already absolute (http/https/protocol-relative)
    if (/^(https?:)?\/\//i.test(path)) return path;
    // make it absolute relative to <base href>, works on nested routes & subfolder deploys
    return new URL(path.replace(/^\/+/, ''), document.baseURI).toString();
  }

  /** Dynamically inject a script and resolve after it executes (order preserved by awaiting). */
  private loadScript(src: string, extraAttrs: Record<string, string> = {}): Promise<void> {
    const url = this.toUrl(src);
    if (this.injected.has(url)) return Promise.resolve(); // already loaded

    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      // Dynamic scripts default to async=true; force sequential execution:
      (s as any).async = false;
      for (const [k, v] of Object.entries(extraAttrs)) s.setAttribute(k, v);
      s.onload = () => { this.injected.add(url); resolve(); };
      s.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.body.appendChild(s);
    });
  }

  /** Load all legacy deps and scripts in strict order (idempotent). */
  async loadAll(): Promise<void> {
    if (this.running) return; // prevent double-runs on HMR
    this.running = true;

    // ---- 1) CDN libraries (ORDER MATTERS) ----
    await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jquery/2.1.3/jquery.min.js');
    await this.loadScript('https://ajax.googleapis.com/ajax/libs/jqueryui/1.11.2/jquery-ui.min.js');

    await this.loadScript('https://api.tiles.mapbox.com/mapbox-gl-js/v1.7.0/mapbox-gl.js');
    await this.loadScript('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v4.2.0/mapbox-gl-geocoder.min.js');

    await this.loadScript('https://www.gstatic.com/firebasejs/12.2.1/firebase-app-compat.js');
    await this.loadScript('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth-compat.js');
    await this.loadScript('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore-compat.js');

    await this.loadScript('https://www.gstatic.com/firebasejs/ui/6.1.0/firebase-ui-auth.js');

    await this.loadScript('https://cdn.jsdelivr.net/npm/emailjs-com@2.3.2/dist/email.min.js');
    try { (window as any).emailjs?.init?.('user_h8aOCHdQhXpblY9crGyiG'); } catch { /* non-fatal */ }

    // ---- 2) Local legacy scripts (served from public/assets/js) ----
    const base = 'assets/js/'; // no leading slash; toUrl() handles base href
    const files = [
      // 'navbar.js',
      'title.js',
      // 'overlay.js',
      // 'scrollspy.js',
      // 'auth.js',
      'sendEmail.js',
      // 'favorites.js',
      // 'mapbox.js',
    ];

    for (const f of files) {
      try { await this.loadScript(base + f); }
      catch (e) { console.warn('[legacy] skip', f, e); }
    }
  }
}
