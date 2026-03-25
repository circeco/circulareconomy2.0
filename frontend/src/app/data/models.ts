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
  website?: string;
  description?: string;
  sectorCategories?: string[];
  actionTags?: ActionTag[];
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

