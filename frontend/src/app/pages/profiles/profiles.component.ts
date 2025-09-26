// src/app/pages/profile/profile.page/profile.page.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'ce-profiles',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profiles.component.html',
  styleUrl: './profiles.component.scss',
})
export class Profiles {}
