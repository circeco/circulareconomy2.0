import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { environment } from './environments/environments';

const DESKTOP_MIN_WIDTH = 1024;
const MOBILE_REDIRECT_URL = '/assets/desktop-only.html';

if (typeof window !== 'undefined') {
  const getReturnUrl = () =>
    encodeURIComponent(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  const redirectToDesktopOnly = () => {
    window.location.replace(`${MOBILE_REDIRECT_URL}?return=${getReturnUrl()}`);
  };

  // Admin/moderation routes must load even on narrow viewports (tablets, split-screen).
  const isAdminPath =
    window.location.pathname.startsWith('/admin');

  if (!isAdminPath && window.innerWidth < DESKTOP_MIN_WIDTH) {
    redirectToDesktopOnly();
  } else if (!isAdminPath) {
    const mediaQuery = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`);
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        redirectToDesktopOnly();
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }
  }
}

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      })
    ),
    provideHttpClient(),

    // Firebase
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
  ],
}).catch(err => console.error(err));
