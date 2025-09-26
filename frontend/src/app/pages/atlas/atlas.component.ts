// src/app/pages/map/map.page.ts
import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

declare global {
  interface Window {
    mapListBtn?: () => void;                         // from overlay.js
    legacy?: { initMap?: (containerId?: string) => void }; // optional shim if you expose one
  }
}

@Component({
  selector: 'ce-atlas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './atlas.component.html',
})
export class Atlas implements AfterViewInit {
  @ViewChild('map', { static: false }) mapEl?: ElementRef<HTMLDivElement>;

  ngAfterViewInit() {
    // If you wrap your map init into a callable function, invoke it here:
    // window.legacy?.initMap?.(this.mapEl?.nativeElement?.id || 'map');
    // Otherwise your existing mapbox.js (deferred) will likely run by itself.
  }

  onMapListBtn() {
    window.mapListBtn?.();
  }
}
