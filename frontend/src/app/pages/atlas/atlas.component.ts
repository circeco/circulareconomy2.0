import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapComponent } from '../../components/map/map.component';

@Component({
  selector: 'atlas-page',
  standalone: true,
  imports: [CommonModule, MapComponent],
  templateUrl: './atlas.component.html',
  styleUrls: ['./atlas.component.scss'],
})
export class AtlasComponent {}
