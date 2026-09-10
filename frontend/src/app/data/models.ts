import type { ActionTag } from './taxonomy';

export type LatLng = { lat: number; lng: number };

export type RecordStatus =
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'edited'
  | 'superseded';

export type SourceType = 'osm' | 'rss' | 'ics' | 'website' | 'other';

export type SourceRef = {
  sourceType: SourceType;
  url: string;
  retrievedAt: string; // ISO timestamp
  licenseNote?: string;
};

export type ReviewMeta = {
  reviewedAt?: string; // ISO timestamp
  reviewedBy?: string; // uid/email (single-reviewer for now)
  notes?: string;
  /** Optional structured reject reason (e.g. duplicate_existing). */
  rejectReason?: string;
};

export type CityDoc = {
  name: string;
  countryCode: string;
  center: LatLng;
  bounds?: { sw: LatLng; ne: LatLng };
  timezone?: string;
  enabled?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type PlaceDoc = {
  cityId: string;
  name: string;
  address: string;
  locationName?: string;
  coords?: LatLng;
  /** Absolute public URL (href). */
  website?: string;
  /** Optional text shown for the website link; empty → short host label. */
  websiteLabel?: string;
  description?: string;
  sectorCategories?: string[];
  actionTags?: ActionTag[];
  /** OSM query clause ids that produced this candidate (discovery only). */
  osmClauses?: string[];
  osmTags?: { shop?: string; amenity?: string; craft?: string };
  placeKey?: string;
  sourceRefs?: SourceRef[];
  status?: RecordStatus;
  review?: ReviewMeta;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type EventDoc = {
  cityId: string;
  title: string;
  startDate: string; // ISO date: YYYY-MM-DD
  endDate?: string;  // ISO date
  locationText: string;
  address?: string;
  locationName?: string;
  coords?: LatLng;
  website?: string;
  description?: string;
  /** Optional UI fields (calendar cards) */
  timeDisplay?: string;
  imageUrl?: string;
  sectorCategories?: string[];
  actionTags?: ActionTag[];
  sourceRefs?: SourceRef[];
  /** Event discovery: search query / seed ids that produced this candidate. */
  eventQueries?: string[];
  /** Links occurrences that share one reviewed series. */
  seriesId?: string;
  /** Recurrence rule copied onto each materialized occurrence. */
  recurrence?: {
    frequency: 'none' | 'weekly' | 'monthly' | 'monthly_nth';
    windowMonths?: number;
    until?: string;
  };
  status?: RecordStatus;
  review?: ReviewMeta;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type EvidenceItem = {
  url: string;
  snippet: string;
  capturedAt: string; // ISO timestamp
};

export type MatchCandidate = {
  collection: 'places' | 'events';
  id: string;
  reason: string;
  confidence: number; // 0-1
};

export type QueueStatus = RecordStatus;

export type PlaceCandidate = Partial<PlaceDoc> & Pick<PlaceDoc, 'name' | 'address'>;
export type EventCandidate = Partial<EventDoc> & Pick<EventDoc, 'title' | 'startDate' | 'locationText'>;

export type ReviewQueueDoc = {
  kind: 'place' | 'event';
  cityId: string;
  status: QueueStatus;
  confidence: number; // 0-1
  candidate: PlaceCandidate | EventCandidate;
  evidence: EvidenceItem[];
  matchCandidates?: MatchCandidate[];
  /** Place discovery: Overpass clause ids attributed to this queue row. */
  osmClauses?: string[];
  /** Event discovery: search query / seed ids attributed to this queue row. */
  eventQueries?: string[];
  review?: ReviewMeta;
  publishedRef?: { collection: 'places' | 'events'; id: string };
  createdAt?: unknown;
  updatedAt?: unknown;
};

// Discriminated specializations for template-safe access.
export type ReviewQueuePlaceDoc = Omit<ReviewQueueDoc, 'kind' | 'candidate'> & {
  kind: 'place';
  candidate: PlaceCandidate;
};

export type ReviewQueueEventDoc = Omit<ReviewQueueDoc, 'kind' | 'candidate'> & {
  kind: 'event';
  candidate: EventCandidate;
};

export type ReviewMemoryDecision = 'approved' | 'rejected';

/** Compact city-scoped memory used by ingestion to avoid re-reviewing already-decided places. */
export type ReviewMemoryDoc = {
  cityId: string;
  fingerprint: string;
  placeKey: string;
  nameNorm: string;
  addressNorm: string;
  geoBucket?: string;
  lastDecision: ReviewMemoryDecision;
  lastReviewedAt: string; // ISO timestamp
  approvedCount: number;
  rejectedCount: number;
  rejectionSignals?: {
    actionTags?: string[];
    sectorCategories?: string[];
  };
  /** Positive learning signals from approved places (tags + name keywords). */
  approvalSignals?: {
    actionTags?: string[];
    sectorCategories?: string[];
    keywords?: string[];
  };
  createdAt?: unknown;
  updatedAt?: unknown;
};

