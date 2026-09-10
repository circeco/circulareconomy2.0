/**
 * Drop stale `place` / `event` focus while merging other query params (keeps `city`).
 * Use with `queryParamsHandling: 'merge'`. Angular removes keys set to `null`.
 */
export const CLEAR_FOCUS_QUERY_PARAMS: { place: null; event: null } = {
  place: null,
  event: null,
};
