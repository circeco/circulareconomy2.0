import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapComponent } from '../../components/map/map.component';

@Component({
  selector: 'app-atlas-page',
  standalone: true,
  imports: [CommonModule, MapComponent],
  templateUrl: './atlas.component.html',
  styleUrls: ['./atlas.component.scss'],
})
export class AtlasComponent {
  onMapListBtn() {
    // Toggle your overlay (you can also forward to a public method on MapComponent via @ViewChild)
    const el = document.getElementById('maplist');
    if (!el) return;
    const open = el.style.width && el.style.width !== '0px';
    el.style.width = open ? '0' : '280px';
  }
}
