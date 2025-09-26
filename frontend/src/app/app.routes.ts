// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/atlas/atlas.component').then(m => m.Atlas),
  },
  {
    path: 'place/:id',
    loadComponent: () =>
      import('./pages/places/places.component').then(
        m => m.Places
      ),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./pages/profiles/profiles.component').then(
        m => m.Profiles
      ),
  },
  { path: '**', redirectTo: '' },
];
