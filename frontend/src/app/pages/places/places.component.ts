// src/app/pages/place-detail/place-detail.page/place-detail.page.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'ce-places',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './places.component.html',
  styleUrl: './places.component.scss',
})
export class Places {}
