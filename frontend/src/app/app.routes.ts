// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing.component').then(m => m.LandingComponent),
    pathMatch: 'full',
    title: 'Circeco'
  },
  {
    path: 'atlas',
    loadComponent: () =>
      import('./pages/atlas/atlas.component').then(m => m.AtlasComponent),
    title: 'Circular Atlas'
  },
  { path: '**', redirectTo: '' },
];
