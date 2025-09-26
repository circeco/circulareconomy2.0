// src/app/pages/map/map.page.ts
import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ce-atlas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './atlas.component.html',
})
export class Atlas {
  @ViewChild('map', { static: true }) mapEl!: ElementRef<HTMLDivElement>;
  // We’ll initialize Mapbox here in Step 3
}
