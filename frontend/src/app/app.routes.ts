// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

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
  {
    path: 'events',
    loadComponent: () =>
      import('./pages/events/events.component').then(m => m.EventsComponent),
    title: 'Circular Events'
  },
  {
    path: 'account',
    loadComponent: () =>
      import('./pages/account/account.component').then(m => m.AccountComponent),
    canActivate: [authGuard],
    title: 'Account'
  },
  {
    path: 'admin/review',
    loadComponent: () =>
      import('./pages/admin-review/admin-review.component').then(m => m.AdminReviewComponent),
    canActivate: [adminGuard],
    title: 'Review Queue'
  },
  {
    path: 'admin/places',
    loadComponent: () =>
      import('./pages/admin-places/admin-places.component').then(m => m.AdminPlacesComponent),
    canActivate: [adminGuard],
    title: 'Admin Places'
  },
  {
    path: 'admin/events',
    loadComponent: () =>
      import('./pages/admin-events/admin-events.component').then(m => m.AdminEventsComponent),
    canActivate: [adminGuard],
    title: 'Admin Events'
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin/admin.component').then(m => m.AdminComponent),
    canActivate: [adminGuard],
    title: 'Admin'
  },
  { path: '**', redirectTo: '' },
];
