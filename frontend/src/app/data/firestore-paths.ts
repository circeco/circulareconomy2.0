/**
 * Centralized Firestore collection paths.
 * Keeping these in one place makes it easier to migrate/refactor later.
 */
export const FS_PATHS = {
  cities: 'cities',
  places: 'places',
  events: 'events',
  reviewQueue: 'reviewQueue',
  reviewMemory: 'reviewMemory',
  reviewMemoryNameIndex: 'reviewMemoryNameIndex',
  reviewMemoryNameGeoIndex: 'reviewMemoryNameGeoIndex',
  reviewMemoryRollups: 'reviewMemoryRollups',

  // user-scoped collections already used by the app
  userFavourites: (uid: string) => `users/${uid}/favourites`,
} as const;

