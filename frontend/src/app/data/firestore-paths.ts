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
  eventReviewMemory: 'eventReviewMemory',
  eventReviewMemoryTitleIndex: 'eventReviewMemoryTitleIndex',
  eventReviewMemoryRollups: 'eventReviewMemoryRollups',
  discoveryConfig: 'discoveryConfig',
  discoveryConfigOsmPlaces: 'osmPlaces',
  discoveryConfigEvents: 'eventDiscovery',
  discoveryJobs: 'discoveryJobs',
  learningStats: 'learningStats',
  discoveryRuns: 'discoveryRuns',

  // user-scoped collections already used by the app
  userFavourites: (uid: string) => `users/${uid}/favourites`,
  userEventFavourites: (uid: string) => `users/${uid}/eventFavourites`,
} as const;

