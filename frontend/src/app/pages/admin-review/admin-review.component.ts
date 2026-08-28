import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  Firestore,
  collection,
  query,
  where,
  limit,
  doc,
  writeBatch,
  updateDoc,
} from '@angular/fire/firestore';
import { deleteField, increment, serverTimestamp } from 'firebase/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, firstValueFrom, of } from 'rxjs';
import { map, shareReplay, catchError, tap, switchMap, distinctUntilChanged } from 'rxjs/operators';

import { FS_PATHS } from '../../data/firestore-paths';
import { CityContextService } from '../../services/city-context.service';
import {
  ACTION_TAG_LABELS,
  ACTION_TAGS,
  canonicalizeActionTags,
  canonicalizeSectorCategories,
  SECTOR_CATEGORIES,
  SECTOR_CATEGORY_LABELS,
} from '../../data/taxonomy';
import {
  DEFAULT_RECURRENCE_WINDOW_MONTHS,
  expandRecurrenceDates,
  formatEventDateLabel,
  inferRecurrenceFromDates,
  recurrenceLabel,
  weekdayNameFromIso,
  weekdayShortFromIso,
  type EventRecurrence,
  type EventRecurrenceFrequency,
} from '../../data/event-recurrence';
import type {
  EventCandidate,
  LatLng,
  PlaceCandidate,
  ReviewQueueEventDoc,
  ReviewQueuePlaceDoc,
} from '../../data/models';

type ReviewQueuePlaceRow = ReviewQueuePlaceDoc & { id: string };
type ReviewQueueEventRow = ReviewQueueEventDoc & { id: string };
type DecisionType = 'approved' | 'rejected';

/** One schedule line in the event editor. */
export type EventOccurrenceRow = {
  date: string;
  time: string; // HH:mm 24h start
  endTime: string; // HH:mm 24h end (optional)
  recurrenceFrequency: EventRecurrenceFrequency;
  until: string;
};

/** Grouped review card: same title/source/location, multiple dates. */
export type EventReviewGroup = {
  id: string;
  cityId: string;
  confidence: number;
  candidate: EventCandidate;
  evidence: ReviewQueueEventRow['evidence'];
  memberIds: string[];
  dates: string[];
};

interface NameIndexDelta {
  docId: string;
  cityId: string;
  nameNorm: string;
  approvedInc: number;
  rejectedInc: number;
  lastDecision: DecisionType;
  lastReviewedAt: string;
  expiresAt: string | null;
}

interface NameGeoIndexDelta {
  docId: string;
  cityId: string;
  nameNorm: string;
  geoBucket: string;
  approvedInc: number;
  rejectedInc: number;
  lastDecision: DecisionType;
  lastReviewedAt: string;
  expiresAt: string | null;
}

interface RollupDelta {
  cityId: string;
  indexedInc: number;
  approvedInc: number;
  rejectedInc: number;
}

interface EventTitleIndexDelta {
  docId: string;
  cityId: string;
  titleNorm: string;
  approvedInc: number;
  rejectedInc: number;
  lastDecision: DecisionType;
  lastReviewedAt: string;
  expiresAt: string | null;
  /** Positive learning signals from approved events (tags + keywords). */
  approvalSignals?: {
    actionTags: string[];
    sectorCategories: string[];
    keywords: string[];
  } | null;
}

interface EventSourceMemoryDelta {
  docId: string;
  cityId: string;
  sourceHost: string;
  approvedInc: number;
  rejectedInc: number;
  lastDecision: DecisionType;
  lastReviewedAt: string;
  expiresAt: string | null;
}

interface PlaceConflict {
  id: string;
  name: string;
  address: string;
  coords?: LatLng;
  website?: string;
  description?: string;
  actionTags?: string[];
  sectorCategories?: string[];
}

/** Flat form for editing an event candidate in the UI */
export interface EventEditForm {
  title: string;
  address: string;
  website: string;
  description: string;
  recurrenceWindowMonths: number;
  occurrenceRows: EventOccurrenceRow[];
  sectorCategories: string[];
  actionTags: string[];
}

/** Flat form for editing a place candidate */
export interface PlaceEditForm {
  name: string;
  address: string;
  description: string;
  website: string;
  locationName: string;
  sectorCategories: string[];
  actionTags: string[];
  latStr: string;
  lngStr: string;
}

@Component({
  selector: 'admin-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-review.component.html',
  styleUrl: './admin-review.component.scss',
})
export class AdminReviewComponent {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);
  private route = inject(ActivatedRoute);
  private readonly rejectOnlyRetentionDays = 180;

  readonly placeQueue$: Observable<ReviewQueuePlaceRow[]>;
  readonly eventQueue$: Observable<ReviewQueueEventRow[]>;
  readonly eventGroups$: Observable<EventReviewGroup[]>;
  readonly placeRows = signal<ReviewQueuePlaceRow[]>([]);

  readonly busyIds = signal<Set<string>>(new Set());
  readonly lastError = signal<string | null>(null);
  readonly rejectSimilarByRowId = signal<Record<string, boolean>>({});
  readonly sectorOptions = SECTOR_CATEGORIES.slice();
  readonly actionTagOptions = ACTION_TAGS.slice();
  readonly reviewKind = signal<'places' | 'events' | 'all'>('all');
  readonly recurrenceOptions: { value: EventRecurrenceFrequency; label: string }[] = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'weekly', label: 'Every week' },
    { value: 'monthly', label: 'Every month (same day)' },
    { value: 'monthly_nth', label: 'Every month (same weekday)' },
  ];
  readonly recurrenceWindowMonths = DEFAULT_RECURRENCE_WINDOW_MONTHS;

  /** Row id whose event editor is open (one at a time per kind) */
  editingEventRowId: string | null = null;
  eventEdit: EventEditForm | null = null;

  editingPlaceRowId: string | null = null;
  placeEdit: PlaceEditForm | null = null;
  creatingEvent = false;
  creatingPlace = false;
  newEventEdit: EventEditForm | null = null;
  newPlaceEdit: PlaceEditForm | null = null;

  constructor() {
    this.route.data.subscribe((data) => {
      const kind = String(data['reviewKind'] ?? 'all');
      if (kind === 'places' || kind === 'events') this.reviewKind.set(kind);
      else this.reviewKind.set('all');
    });

    const col = collection(this.fs, FS_PATHS.reviewQueue);
    const queue$ = this.cityContext.cityId$.pipe(
      distinctUntilChanged(),
      switchMap((cityId) => {
        const q = query(col, where('status', '==', 'needs_review'), where('cityId', '==', cityId), limit(300));
        return collectionData(q, { idField: 'id' }).pipe(
          map((docs: Record<string, unknown>[]) => {
            const sorted = [...docs].sort(
              (a, b) => Number(b['confidence'] ?? 0) - Number(a['confidence'] ?? 0)
            );
            const places = sorted.filter((d) => d['kind'] === 'place') as unknown as ReviewQueuePlaceRow[];
            const events = sorted.filter((d) => d['kind'] === 'event') as unknown as ReviewQueueEventRow[];
            return { places, events };
          }),
          tap(() => this.lastError.set(null)),
          catchError((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.lastError.set(msg);
            return of({ places: [] as ReviewQueuePlaceRow[], events: [] as ReviewQueueEventRow[] });
          })
        );
      }),
      shareReplay(1)
    );
    this.placeQueue$ = queue$.pipe(map((x) => x.places));
    this.eventQueue$ = queue$.pipe(map((x) => x.events));
    this.eventGroups$ = this.eventQueue$.pipe(map((rows) => this.groupEventRows(rows)));
    this.placeQueue$.subscribe((rows) => this.placeRows.set(rows));
  }

  showPlacesPanel(): boolean {
    const kind = this.reviewKind();
    return kind === 'all' || kind === 'places';
  }

  showEventsPanel(): boolean {
    const kind = this.reviewKind();
    return kind === 'all' || kind === 'events';
  }

  isSinglePanelMode(): boolean {
    return this.showPlacesPanel() !== this.showEventsPanel();
  }

  pageTitle(): string {
    const kind = this.reviewKind();
    if (kind === 'places') return 'Places Review Queue';
    if (kind === 'events') return 'Events Review Queue';
    return 'Review Queue';
  }

  toggleEventEdit(group: EventReviewGroup): void {
    if (this.editingEventRowId === group.id) {
      this.editingEventRowId = null;
      this.eventEdit = null;
      return;
    }
    this.closePlaceEditor();
    this.cancelCreateEvent();
    this.cancelCreatePlace();
    this.editingEventRowId = group.id;
    const form = this.buildEventForm(group.candidate, group.dates);
    if (!form.website) {
      form.website = this.eventSourceUrlFromEvidence(group.evidence, group.candidate.website);
    }
    this.eventEdit = form;
  }

  togglePlaceEdit(row: ReviewQueuePlaceRow): void {
    if (this.editingPlaceRowId === row.id) {
      this.editingPlaceRowId = null;
      this.placeEdit = null;
      return;
    }
    this.closeEventEditor();
    this.cancelCreateEvent();
    this.cancelCreatePlace();
    this.editingPlaceRowId = row.id;
    this.placeEdit = this.buildPlaceForm(row.candidate);
  }

  private closeEventEditor(): void {
    this.editingEventRowId = null;
    this.eventEdit = null;
  }

  private closePlaceEditor(): void {
    this.editingPlaceRowId = null;
    this.placeEdit = null;
  }

  openCreateEvent(): void {
    this.closePlaceEditor();
    this.creatingPlace = false;
    this.closeEventEditor();
    this.creatingEvent = true;
    this.newEventEdit = this.buildEventForm({
      title: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      locationText: '',
      address: '',
      description: '',
      timeDisplay: '',
      imageUrl: '',
      sectorCategories: [],
      actionTags: [],
      recurrence: { frequency: 'none', windowMonths: DEFAULT_RECURRENCE_WINDOW_MONTHS },
    });
  }

  cancelCreateEvent(): void {
    this.creatingEvent = false;
    this.newEventEdit = null;
  }

  openCreatePlace(): void {
    this.closeEventEditor();
    this.creatingEvent = false;
    this.closePlaceEditor();
    this.creatingPlace = true;
    this.newPlaceEdit = this.buildPlaceForm({
      name: '',
      address: '',
      locationName: '',
      description: '',
      website: '',
      sectorCategories: [],
      actionTags: [],
    });
  }

  cancelCreatePlace(): void {
    this.creatingPlace = false;
    this.newPlaceEdit = null;
  }

  private closeEditorsForRow(id: string): void {
    if (this.editingEventRowId === id) this.closeEventEditor();
    if (this.editingPlaceRowId === id) this.closePlaceEditor();
  }

  async saveEventDraft(group: EventReviewGroup): Promise<void> {
    if (!this.eventEdit || this.editingEventRowId !== group.id) return;
    const candidate = this.eventFormToCandidate(this.eventEdit);
    // Persist editor rows as-is (do not expand recurrence here — that happens on approve).
    const occ = (this.eventEdit.occurrenceRows || [])
      .map((r) => ({
        date: String(r.date || '').trim(),
        timeDisplay: this.formatTimeDisplayRange(r.time || '', r.endTime || ''),
      }))
      .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date));
    if (!occ.length) {
      this.lastError.set('Add at least one valid date before saving.');
      return;
    }

    await this.runWrite(`${group.id}:save-event`, async (batch) => {
      const members = group.memberIds;
      const sharedCandidate = {
        ...group.candidate,
        ...candidate,
      };

      for (let i = 0; i < members.length; i++) {
        const ref = doc(this.fs, FS_PATHS.reviewQueue, members[i]);
        if (i < occ.length) {
          batch.update(ref, {
            candidate: {
              ...sharedCandidate,
              startDate: occ[i].date,
              endDate: occ[i].date,
              timeDisplay: occ[i].timeDisplay || candidate.timeDisplay || '',
            },
            updatedAt: serverTimestamp(),
          });
        } else {
          // Date removed in editor — drop extra queue siblings from needs_review.
          batch.update(ref, {
            status: 'superseded',
            updatedAt: serverTimestamp(),
          });
        }
      }

      for (let i = members.length; i < occ.length; i++) {
        const newRef = doc(collection(this.fs, FS_PATHS.reviewQueue));
        batch.set(newRef, {
          kind: 'event',
          cityId: group.cityId,
          status: 'needs_review',
          confidence: group.confidence,
          candidate: {
            ...sharedCandidate,
            startDate: occ[i].date,
            endDate: occ[i].date,
            timeDisplay: occ[i].timeDisplay || candidate.timeDisplay || '',
          },
          evidence: Array.isArray(group.evidence) ? group.evidence : [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    this.closeEventEditor();
  }

  async savePlaceDraft(row: ReviewQueuePlaceRow): Promise<void> {
    if (!this.placeEdit || this.editingPlaceRowId !== row.id) return;
    const candidate = this.placeFormToCandidate(this.placeEdit);
    await this.runSingleOp(`${row.id}:save-place`, () =>
      updateDoc(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        candidate: { ...row.candidate, ...candidate },
        updatedAt: serverTimestamp(),
      })
    );
    this.closePlaceEditor();
  }

  async createEvent(): Promise<void> {
    const form = this.newEventEdit;
    if (!this.creatingEvent || !form) return;
    const c = this.eventFormToCandidate(form);
    const occurrences = this.resolveOccurrencesFromForm(form);
    if (!c.title || !occurrences.length || !c.address) {
      this.lastError.set('Event requires title, at least one date, and address.');
      return;
    }
    const cityId = this.cityContext.cityId();
    const reviewedAt = new Date().toISOString();
    const eventSectorCategories = this.ensureEventSectorCategories(c);
    const seriesId =
      occurrences.length > 1 || (c.recurrence && c.recurrence.frequency !== 'none') ? this.newSeriesId() : '';
    await this.runWrite('manual:add-event', async (batch) => {
      for (const occ of occurrences) {
        const newRef = doc(collection(this.fs, FS_PATHS.events));
        batch.set(
          newRef,
          this.buildPublishedEventPayload({
            cityId,
            candidate: { ...c, timeDisplay: occ.time || c.timeDisplay },
            startDate: occ.date,
            seriesId,
            eventSectorCategories,
            sourceRefs: this.manualSourceRefs(c.website),
            reviewedAt,
          })
        );
      }
    });
    this.cancelCreateEvent();
  }

  async createPlace(): Promise<void> {
    const form = this.newPlaceEdit;
    if (!this.creatingPlace || !form) return;
    const c = this.placeFormToCandidate(form);
    if (!c.name || !c.address) {
      this.lastError.set('Place requires name and address.');
      return;
    }
    const cityId = this.cityContext.cityId();
    let ll = this.normalizeLatLng(c.coords);
    if (!ll) {
      ll = await this.geocodeFromAddress(cityId, c.address, c.name || '');
      if (!ll) {
        this.lastError.set('Could not derive coordinates from address. Please add latitude/longitude.');
        return;
      }
      c.coords = ll;
      this.newPlaceEdit = { ...form, latStr: String(ll.lat), lngStr: String(ll.lng) };
    } else {
      c.coords = ll;
    }
    const conflict = await this.detectPlaceConflicts(cityId, c as PlaceCandidate);
    if (conflict.exact) {
      this.lastError.set('This place already exists (same name and address).');
      return;
    }
    if (conflict.uncertain.length > 0) {
      await this.enqueueManualPlaceConflictReview(cityId, c as PlaceCandidate, conflict.uncertain);
      this.cancelCreatePlace();
      this.lastError.set('Possible duplicate detected. Added both places to review queue.');
      return;
    }
    const reviewedAt = new Date().toISOString();
    await this.runWrite('manual:add-place', async (batch) => {
      const newRef = doc(collection(this.fs, FS_PATHS.places));
      batch.set(newRef, {
        cityId,
        name: c.name,
        address: c.address,
        locationName: c.locationName ?? '',
        ...this.coordsField(c.coords),
        website: c.website ?? '',
        description: c.description ?? '',
        sectorCategories: c.sectorCategories ?? [],
        actionTags: (c.actionTags ?? []) as string[],
        sourceRefs: [],
        status: 'approved',
        review: { reviewedAt },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await this.persistReviewMemoryLearning([
      { cityId, candidate: c, decision: 'approved', reviewedAtIso: reviewedAt },
    ]);
    this.cancelCreatePlace();
  }

  async approvePlace(row: ReviewQueuePlaceRow): Promise<void> {
    const c = this.mergedPlaceCandidate(row);
    const reviewedAt = new Date().toISOString();
    await this.runWrite(row.id, async (batch) => {
      const newRef = doc(collection(this.fs, FS_PATHS.places));
      batch.set(newRef, {
        cityId: row.cityId,
        name: c.name,
        address: c.address,
        locationName: c.locationName ?? '',
        ...this.coordsField(c.coords),
        website: c.website ?? '',
        description: c.description ?? '',
        sectorCategories: c.sectorCategories ?? [],
        actionTags: (c.actionTags ?? []) as string[],
        sourceRefs: this.evidenceToSourceRefs(row),
        status: 'approved',
        review: { reviewedAt },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        status: 'approved',
        publishedRef: { collection: 'places', id: newRef.id },
        review: { reviewedAt },
        updatedAt: serverTimestamp(),
      });
    });
    await this.persistReviewMemoryLearning([
      { cityId: row.cityId, candidate: c, decision: 'approved', reviewedAtIso: reviewedAt },
    ]);
    this.closeEditorsForRow(row.id);
  }

  async rejectPlace(row: ReviewQueuePlaceRow): Promise<void> {
    const rejectSimilar = this.rejectSimilarByRowId()[row.id] === true;
    const ids = rejectSimilar ? this.similarPlaceIds(row) : [row.id];
    const reviewedAt = new Date().toISOString();
    const placeMap = new Map(this.placeRows().map((r) => [r.id, r] as const));
    const learningEntries: Array<{
      cityId: string;
      candidate: Partial<PlaceCandidate>;
      decision: DecisionType;
      reviewedAtIso: string;
    }> = [];
    await this.runWrite(row.id, async (batch) => {
      for (const id of ids) {
        const source = placeMap.get(id) ?? row;
        const candidate =
          id === row.id ? this.mergedPlaceCandidate(row) : source.candidate;
        batch.update(doc(this.fs, FS_PATHS.reviewQueue, id), {
          status: 'rejected',
          review: { reviewedAt },
          updatedAt: serverTimestamp(),
        });
        learningEntries.push({
          cityId: source.cityId,
          candidate,
          decision: 'rejected',
          reviewedAtIso: reviewedAt,
        });
      }
    });
    await this.persistReviewMemoryLearning(learningEntries);
    this.clearRejectSimilar(row.id);
    this.closeEditorsForRow(row.id);
  }

  similarPlaceCount(row: ReviewQueuePlaceRow): number {
    return this.similarPlaceIds(row).length;
  }

  isRejectSimilarEnabled(rowId: string): boolean {
    return this.rejectSimilarByRowId()[rowId] === true;
  }

  setRejectSimilar(rowId: string, checked: boolean): void {
    const next = { ...this.rejectSimilarByRowId(), [rowId]: checked };
    this.rejectSimilarByRowId.set(next);
  }

  private clearRejectSimilar(rowId: string): void {
    const next = { ...this.rejectSimilarByRowId() };
    delete next[rowId];
    this.rejectSimilarByRowId.set(next);
  }

  private similarPlaceIds(row: ReviewQueuePlaceRow): string[] {
    const key = this.chainKey(row.candidate?.name);
    if (!key) return [row.id];
    const ids = this.placeRows()
      .filter((r) => this.chainKey(r.candidate?.name) === key)
      .map((r) => r.id);
    return ids.length ? ids : [row.id];
  }

  /**
   * Heuristic chain key from candidate name (e.g. "La Feltrinelli Express" -> "feltrinelli").
   * Used only for bulk reject convenience in the review queue.
   */
  private chainKey(name: unknown): string {
    const tokens = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f ]+/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tokens.length) return '';
    const stop = new Set([
      'la', 'il', 'lo', 'i', 'gli', 'le', 'l', 'the',
      'store', 'shop', 'libreria', 'bookstore', 'books', 'book',
      'express', 'official', 'point', 'punto',
    ]);
    const core = tokens.filter((t) => !stop.has(t) && t.length >= 3);
    return core[0] || tokens[0];
  }

  async approveEvent(group: EventReviewGroup): Promise<void> {
    const form =
      this.editingEventRowId === group.id && this.eventEdit
        ? this.eventEdit
        : this.buildEventForm(group.candidate, group.dates);
    const c = { ...group.candidate, ...this.eventFormToCandidate(form) };
    const reviewedAt = new Date().toISOString();
    const eventSectorCategories = this.ensureEventSectorCategories(c);
    const occurrences = this.resolveOccurrencesFromForm(form);
    if (!occurrences.length) {
      this.lastError.set('Event requires at least one date.');
      return;
    }
    const seriesId =
      occurrences.length > 1 || (c.recurrence && c.recurrence.frequency !== 'none') ? this.newSeriesId() : '';
    let firstPublishedId = '';
    await this.runWrite(group.id, async (batch) => {
      for (const occ of occurrences) {
        const newRef = doc(collection(this.fs, FS_PATHS.events));
        if (!firstPublishedId) firstPublishedId = newRef.id;
        batch.set(
          newRef,
          this.buildPublishedEventPayload({
            cityId: group.cityId,
            candidate: { ...c, timeDisplay: occ.time || c.timeDisplay },
            startDate: occ.date,
            seriesId,
            eventSectorCategories,
            sourceRefs: this.evidenceToSourceRefs(
              { evidence: group.evidence } as ReviewQueueEventRow,
              c.website
            ),
            reviewedAt,
          })
        );
      }
      for (const memberId of group.memberIds) {
        batch.update(doc(this.fs, FS_PATHS.reviewQueue, memberId), {
          status: 'approved',
          publishedRef: { collection: 'events', id: firstPublishedId || memberId },
          review: { reviewedAt },
          updatedAt: serverTimestamp(),
        });
      }
    });
    await this.persistEventReviewMemoryLearning([
      {
        cityId: group.cityId,
        candidate: { ...c, startDate: occurrences[0]?.date || c.startDate },
        decision: 'approved',
        reviewedAtIso: reviewedAt,
        // Multi-date / recurring approvals also teach the series fingerprint.
        alsoSeries: occurrences.length > 1 || !!(c.recurrence && c.recurrence.frequency !== 'none'),
        sourceUrlHint: this.eventSourceUrlFromEvidence(group.evidence, c.website),
      },
    ]);
    this.closeEditorsForRow(group.id);
  }

  async rejectEvent(group: EventReviewGroup): Promise<void> {
    const reviewedAt = new Date().toISOString();
    const c = this.mergedEventCandidate(group);
    await this.runWrite(group.id, async (batch) => {
      for (const memberId of group.memberIds) {
        batch.update(doc(this.fs, FS_PATHS.reviewQueue, memberId), {
          status: 'rejected',
          review: { reviewedAt },
          updatedAt: serverTimestamp(),
        });
      }
    });
    await this.persistEventReviewMemoryLearning([
      {
        cityId: group.cityId,
        candidate: c,
        decision: 'rejected',
        reviewedAtIso: reviewedAt,
        alsoSeries: group.memberIds.length > 1 || !!(c.recurrence && c.recurrence.frequency !== 'none'),
        sourceUrlHint: this.eventSourceUrlFromEvidence(group.evidence, c.website),
      },
    ]);
    this.closeEditorsForRow(group.id);
  }

  /**
   * Clone this review card into a new needs_review item (original stays).
   * Title gets a "(copy)" suffix so it shows as a separate card instead of merging with the original.
   */
  async duplicateEvent(group: EventReviewGroup): Promise<void> {
    const base = this.mergedEventCandidate(group);
    const copyTitle = this.nextCopyTitle(base.title || 'Event');
    const dates = group.dates.length
      ? group.dates
      : [String(base.startDate || '').trim()].filter(Boolean);
    const datesToCopy = dates.length ? dates : [new Date().toISOString().slice(0, 10)];

    await this.runWrite(`${group.id}:duplicate`, async (batch) => {
      for (const date of datesToCopy) {
        const newRef = doc(collection(this.fs, FS_PATHS.reviewQueue));
        batch.set(newRef, {
          kind: 'event',
          cityId: group.cityId,
          status: 'needs_review',
          confidence: group.confidence,
          candidate: {
            ...base,
            title: copyTitle,
            startDate: date,
            endDate: date,
          },
          evidence: Array.isArray(group.evidence) ? [...group.evidence] : [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  }

  /**
   * Drop from the review queue without writing review memory / learning signals.
   * Uses `superseded` (same as editor date removal) so discovery is not taught a reject.
   */
  async removeEvent(group: EventReviewGroup): Promise<void> {
    await this.runWrite(`${group.id}:remove`, async (batch) => {
      for (const memberId of group.memberIds) {
        batch.update(doc(this.fs, FS_PATHS.reviewQueue, memberId), {
          status: 'superseded',
          updatedAt: serverTimestamp(),
        });
      }
    });
    this.closeEditorsForRow(group.id);
  }

  private nextCopyTitle(title: string): string {
    const t = String(title || '').trim() || 'Event';
    if (/\(copy(?:\s+\d+)?\)$/i.test(t)) {
      const m = t.match(/^(.*)\(copy(?:\s+(\d+))?\)$/i);
      const stem = (m?.[1] || t).trim();
      const n = Number(m?.[2] || 1) + 1;
      return `${stem} (copy ${n})`;
    }
    return `${t} (copy)`;
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  cityId(): string {
    return this.cityContext.cityId();
  }

  private mergedEventCandidate(group: EventReviewGroup): EventCandidate {
    if (this.editingEventRowId === group.id && this.eventEdit) {
      return { ...group.candidate, ...this.eventFormToCandidate(this.eventEdit) };
    }
    return group.candidate;
  }

  private mergedPlaceCandidate(row: ReviewQueuePlaceRow): PlaceCandidate {
    if (this.editingPlaceRowId === row.id && this.placeEdit) {
      return { ...row.candidate, ...this.placeFormToCandidate(this.placeEdit) };
    }
    return row.candidate;
  }

  private buildEventForm(c: EventCandidate, groupDates?: string[]): EventEditForm {
    const dates = [...new Set([...(groupDates || []), c.startDate].filter(Boolean) as string[])].sort();
    // Respect an explicit "Does not repeat" — do not re-infer weekly from multi-date groups.
    const storedFreq = c.recurrence?.frequency;
    let inferred: EventRecurrenceFrequency = 'none';
    if (storedFreq === 'none') {
      inferred = 'none';
    } else if (storedFreq === 'weekly' || storedFreq === 'monthly' || storedFreq === 'monthly_nth') {
      inferred = storedFreq;
    } else {
      inferred = inferRecurrenceFromDates(dates) || 'none';
    }
    const { time, endTime } = this.parseTimeDisplayRange(c.timeDisplay || '');
    const until = c.recurrence?.until ?? '';
    const occurrenceRows: EventOccurrenceRow[] = (dates.length ? dates : ['']).map((date, index) => ({
      date,
      time,
      endTime,
      // Apply inferred/shared recurrence on the first row only; extra dates stay one-off.
      recurrenceFrequency: index === 0 ? inferred : 'none',
      until: index === 0 ? until : '',
    }));
    if (!occurrenceRows.length) {
      occurrenceRows.push({
        date: new Date().toISOString().slice(0, 10),
        time: '',
        endTime: '',
        recurrenceFrequency: 'none',
        until: '',
      });
    }
    return {
      title: c.title ?? '',
      address: String(c.address || c.locationText || '').trim(),
      website: c.website ?? '',
      description: c.description ?? '',
      recurrenceWindowMonths: c.recurrence?.windowMonths ?? DEFAULT_RECURRENCE_WINDOW_MONTHS,
      occurrenceRows,
      sectorCategories: canonicalizeSectorCategories((c.sectorCategories ?? []) as string[]),
      actionTags: canonicalizeActionTags((c.actionTags ?? []) as string[]),
    };
  }

  private buildPlaceForm(c: PlaceCandidate): PlaceEditForm {
    const lat = c.coords?.lat;
    const lng = c.coords?.lng;
    return {
      name: c.name ?? '',
      address: c.address ?? '',
      description: c.description ?? '',
      website: c.website ?? '',
      locationName: c.locationName ?? '',
      sectorCategories: canonicalizeSectorCategories((c.sectorCategories ?? []) as string[]),
      actionTags: canonicalizeActionTags((c.actionTags ?? []) as string[]),
      latStr: lat != null && isFinite(lat) ? String(lat) : '',
      lngStr: lng != null && isFinite(lng) ? String(lng) : '',
    };
  }

  private eventFormToCandidate(f: EventEditForm): Partial<EventCandidate> {
    const rows = (f.occurrenceRows || []).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '').trim()));
    const primary = rows[0] || f.occurrenceRows[0];
    const start = String(primary?.date || '').trim();
    // Single UI field: keep address for map geocoding later; mirror into locationText for display.
    const address = this.normalizeAddressDisplay(f.address);
    const recurringRow = rows.find((r) => r.recurrenceFrequency && r.recurrenceFrequency !== 'none');
    return {
      title: f.title.trim(),
      startDate: start,
      endDate: start,
      locationText: address,
      address,
      website: f.website.trim(),
      description: f.description.trim(),
      timeDisplay: this.formatTimeDisplayRange(primary?.time || '', primary?.endTime || ''),
      recurrence: this.firestoreRecurrence(
        recurringRow?.recurrenceFrequency || 'none',
        Number(f.recurrenceWindowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS,
        recurringRow?.until
      ),
      sectorCategories: canonicalizeSectorCategories(f.sectorCategories),
      actionTags: canonicalizeActionTags(f.actionTags) as EventCandidate['actionTags'],
    };
  }

  eventDateDisplay(c: EventCandidate): string {
    const start = String(c.startDate || '').trim();
    if (!start) return '';
    const label = formatEventDateLabel(start);
    const time = this.formatTimeDisplayRangeFromRaw(c.timeDisplay || '');
    return time ? `${label} · ${time}` : label;
  }

  eventGroupDateDisplay(group: EventReviewGroup): string {
    const dates = group.dates.length ? group.dates : [group.candidate.startDate].filter(Boolean);
    if (!dates.length) return '';
    const time = this.formatTimeDisplayRangeFromRaw(group.candidate.timeDisplay || '');
    const labels = dates.map((d) => formatEventDateLabel(d));
    if (labels.length === 1) return time ? `${labels[0]} · ${time}` : labels[0];
    if (labels.length <= 4) return labels.join(', ');
    return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`;
  }

  eventRecurrenceDisplay(group: EventReviewGroup): string {
    const c =
      this.editingEventRowId === group.id && this.eventEdit
        ? this.eventFormToCandidate(this.eventEdit)
        : group.candidate;
    return recurrenceLabel(c.recurrence, c.startDate || group.dates[0] || '');
  }

  previewOccurrenceCount(form: EventEditForm | null): number {
    if (!form) return 0;
    return this.resolveOccurrencesFromForm(form).length;
  }

  eventAddressDisplay(c: EventCandidate): string {
    return String(c.address || c.locationText || '').trim();
  }

  eventSourceUrl(row: ReviewQueueEventRow | EventReviewGroup): string {
    const website = String(('candidate' in row ? row.candidate.website : '') || '').trim();
    if (website) return website;
    return this.eventSourceUrlFromEvidence(row.evidence, website);
  }

  addOccurrenceRow(form: EventEditForm): void {
    form.occurrenceRows = [
      ...form.occurrenceRows,
      { date: '', time: '', endTime: '', recurrenceFrequency: 'none', until: '' },
    ];
  }

  removeOccurrenceRow(form: EventEditForm, index: number): void {
    if (form.occurrenceRows.length <= 1) return;
    form.occurrenceRows = form.occurrenceRows.filter((_, i) => i !== index);
  }

  weekdayLabel(iso: string): string {
    return weekdayShortFromIso(iso);
  }

  recurrenceOptionLabel(value: EventRecurrenceFrequency, dateIso: string): string {
    const day = weekdayNameFromIso(dateIso);
    if (value === 'none') return 'Does not repeat';
    if (value === 'weekly') return day ? `Every ${day}` : 'Every week';
    if (value === 'monthly') return 'Every month (same day)';
    if (value === 'monthly_nth') {
      if (!day) return 'Every month (same weekday)';
      const dtMatch = /^\d{4}-\d{2}-\d{2}$/.exec(String(dateIso || '').trim());
      if (!dtMatch) return `Every ${day} of the month`;
      // Reuse recurrenceLabel for "last/1st/…" wording.
      return recurrenceLabel({ frequency: 'monthly_nth' }, dateIso) || `Every ${day} of the month`;
    }
    return value;
  }

  /** Expand editor rows into concrete publishable occurrences. */
  resolveOccurrencesFromForm(form: EventEditForm): Array<{ date: string; time: string }> {
    const out: Array<{ date: string; time: string }> = [];
    const windowMonths = Number(form.recurrenceWindowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS;
    for (const row of form.occurrenceRows || []) {
      const date = String(row.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const time = this.formatTimeDisplayRange(row.time || '', row.endTime || '');
      const freq = row.recurrenceFrequency || 'none';
      if (freq === 'none') {
        out.push({ date, time });
        continue;
      }
      const expanded = expandRecurrenceDates(date, {
        frequency: freq,
        windowMonths,
        until: String(row.until || '').trim() || undefined,
      });
      for (const d of expanded) out.push({ date: d, time });
    }
    const seen = new Set<string>();
    return out.filter((o) => {
      const key = `${o.date}|${o.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private parseTimeDisplayRange(raw: string): { time: string; endTime: string } {
    const s = String(raw || '').trim();
    const range = s.match(/^(\d{1,2}:\d{2})(?::\d{2})?\s*[–\-—]\s*(\d{1,2}:\d{2})(?::\d{2})?$/);
    if (range) {
      return {
        time: this.normalizeTime24h(range[1]),
        endTime: this.normalizeTime24h(range[2]),
      };
    }
    return { time: this.normalizeTime24h(s), endTime: '' };
  }

  private formatTimeDisplayRange(startRaw: string, endRaw: string): string {
    const start = this.normalizeTime24h(startRaw);
    const end = this.normalizeTime24h(endRaw);
    if (start && end) return `${start}–${end}`;
    return start || end || '';
  }

  private formatTimeDisplayRangeFromRaw(raw: string): string {
    const { time, endTime } = this.parseTimeDisplayRange(raw);
    return this.formatTimeDisplayRange(time, endTime);
  }

  private normalizeTime24h(raw: string): string {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return '';
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return '';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** Firestore rejects `undefined` field values — omit empty until. */
  private firestoreRecurrence(
    frequency: EventRecurrenceFrequency | string | undefined,
    windowMonths?: number,
    until?: string
  ): EventRecurrence {
    const freq = (frequency || 'none') as EventRecurrenceFrequency;
    const recurrence: EventRecurrence = {
      frequency: freq,
      windowMonths: Number(windowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS,
    };
    const untilDay = String(until || '').trim();
    if (untilDay) recurrence.until = untilDay;
    return recurrence;
  }

  private eventSourceUrlFromEvidence(
    evidence: ReviewQueueEventRow['evidence'] | undefined,
    website?: string
  ): string {
    const w = String(website || '').trim();
    if (w) return w;
    return Array.isArray(evidence) ? String(evidence.find((e) => e?.url)?.url || '').trim() : '';
  }

  private newSeriesId(): string {
    return `series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildPublishedEventPayload(args: {
    cityId: string;
    candidate: Partial<EventCandidate>;
    startDate: string;
    seriesId: string;
    eventSectorCategories: string[];
    sourceRefs: ReturnType<AdminReviewComponent['manualSourceRefs']>;
    reviewedAt: string;
  }): Record<string, unknown> {
    const c = args.candidate;
    const recurrence = this.firestoreRecurrence(
      c.recurrence?.frequency || 'none',
      c.recurrence?.windowMonths,
      c.recurrence?.until
    );
    const payload: Record<string, unknown> = {
      cityId: args.cityId,
      title: c.title,
      startDate: args.startDate,
      endDate: args.startDate,
      locationText: c.locationText,
      address: c.address ?? '',
      locationName: c.locationName ?? '',
      ...this.coordsField(c.coords),
      website: c.website ?? '',
      description: c.description ?? '',
      timeDisplay: c.timeDisplay ?? '',
      imageUrl: c.imageUrl ?? '',
      sectorCategories: args.eventSectorCategories,
      actionTags: (c.actionTags ?? []) as string[],
      sourceRefs: args.sourceRefs,
      recurrence,
      status: 'approved',
      review: { reviewedAt: args.reviewedAt },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (args.seriesId) payload['seriesId'] = args.seriesId;
    return payload;
  }

  private groupEventRows(rows: ReviewQueueEventRow[]): EventReviewGroup[] {
    const map = new Map<string, ReviewQueueEventRow[]>();
    for (const row of rows) {
      const key = this.eventGroupKey(row);
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    const groups: EventReviewGroup[] = [];
    for (const list of map.values()) {
      list.sort((a, b) => String(a.candidate.startDate || '').localeCompare(String(b.candidate.startDate || '')));
      const primary = list[0];
      const dates = [...new Set(list.map((r) => String(r.candidate.startDate || '').trim()).filter(Boolean))].sort();
      const inferredFreq = inferRecurrenceFromDates(dates);
      const storedFreq = primary.candidate.recurrence?.frequency;
      let recurrence: EventCandidate['recurrence'] = { frequency: 'none' };
      if (storedFreq === 'none') {
        recurrence = { frequency: 'none' };
      } else if (storedFreq === 'weekly' || storedFreq === 'monthly' || storedFreq === 'monthly_nth') {
        recurrence = primary.candidate.recurrence || { frequency: storedFreq };
      } else if (inferredFreq !== 'none') {
        recurrence = { frequency: inferredFreq, windowMonths: DEFAULT_RECURRENCE_WINDOW_MONTHS };
      }
      const candidate: EventCandidate = {
        ...primary.candidate,
        startDate: dates[0] || primary.candidate.startDate,
        endDate: dates[0] || primary.candidate.endDate || primary.candidate.startDate,
        recurrence,
      };
      groups.push({
        id: primary.id,
        cityId: primary.cityId,
        confidence: Math.max(...list.map((r) => Number(r.confidence || 0))),
        candidate,
        evidence: primary.evidence,
        memberIds: list.map((r) => r.id),
        dates,
      });
    }
    return groups.sort((a, b) => b.confidence - a.confidence);
  }

  private eventGroupKey(row: ReviewQueueEventRow): string {
    const title = this.normalizeText(row.candidate.title || '');
    const loc = this.normalizeText(row.candidate.address || row.candidate.locationText || '');
    let host = '';
    try {
      const url = row.candidate.website || row.evidence?.[0]?.url || '';
      host = url ? new URL(url).hostname.replace(/^www\./i, '').toLowerCase() : '';
    } catch {
      host = '';
    }
    return `${row.cityId}|${title}|${loc}|${host}`;
  }

  private ensureEventSectorCategories(c: Partial<EventCandidate>): string[] {
    const existing = canonicalizeSectorCategories((c.sectorCategories ?? []) as string[]);
    if (existing.length) return existing;
    const text = `${c.title || ''} ${c.description || ''} ${c.locationText || ''}`.toLowerCase();
    const inferred = new Set<string>();
    if (/(cloth|fashion|apparel|textile|wardrobe|abbigli|vestit)/.test(text)) inferred.add('apparel');
    if (/(furniture|home|garden|house|arredo|mobili)/.test(text)) inferred.add('home-garden');
    if (/(bike|bicycle|cycling|sport|cicl)/.test(text)) inferred.add('cycling-sports');
    if (/(electronic|phone|laptop|computer|tech|elettron)/.test(text)) inferred.add('electronics');
    if (/(book|books|comic|magazine|libri|fumett|rivist)/.test(text)) inferred.add('books-comics-magazines');
    if (/(music|vinyl|record|strument|concerto)/.test(text)) inferred.add('music');
    const actions = canonicalizeActionTags((c.actionTags ?? []) as string[]);
    if (inferred.size === 0) {
      if (actions.includes('repair')) inferred.add('electronics');
      if (actions.includes('reuse')) inferred.add('apparel');
      if (actions.some((x) => x === 'recycle' || x === 'reduce' || x === 'refuse' || x === 'repurpose')) inferred.add('home-garden');
    }
    if (inferred.size === 0) inferred.add('home-garden');
    return canonicalizeSectorCategories([...inferred]);
  }

  private placeFormToCandidate(f: PlaceEditForm): Partial<PlaceCandidate> {
    const lat = parseFloat(f.latStr.trim());
    const lng = parseFloat(f.lngStr.trim());
    const base: Partial<PlaceCandidate> = {
      name: f.name.trim(),
      address: this.normalizeAddressDisplay(f.address),
      description: f.description.trim(),
      website: f.website.trim(),
      locationName: f.locationName.trim(),
      sectorCategories: canonicalizeSectorCategories(f.sectorCategories),
      actionTags: canonicalizeActionTags(f.actionTags) as PlaceCandidate['actionTags'],
    };
    if (isFinite(lat) && isFinite(lng)) {
      base.coords = { lat, lng };
    }
    return base;
  }

  displayActionTags(values: string[] | undefined): string[] {
    return canonicalizeActionTags(this.expandDelimited(values)).map((t) => ACTION_TAG_LABELS[t]);
  }

  displaySectorCategories(values: string[] | undefined): string[] {
    return canonicalizeSectorCategories(this.expandDelimited(values)).map((s) => SECTOR_CATEGORY_LABELS[s]);
  }

  sectorLabel(id: string): string {
    return SECTOR_CATEGORY_LABELS[id as keyof typeof SECTOR_CATEGORY_LABELS] || id;
  }

  actionTagLabel(id: string): string {
    return ACTION_TAG_LABELS[id as keyof typeof ACTION_TAG_LABELS] || id;
  }

  isSelected(values: string[] | undefined, id: string): boolean {
    return Array.isArray(values) && values.includes(id);
  }

  toggleSelection(values: string[] | undefined, id: string, checked: boolean): string[] {
    const current = Array.isArray(values) ? values.slice() : [];
    const idx = current.indexOf(id);
    if (checked && idx === -1) current.push(id);
    if (!checked && idx !== -1) current.splice(idx, 1);
    return current;
  }

  private expandDelimited(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    const out: string[] = [];
    for (const raw of values) {
      for (const part of String(raw || '').split(/[;,]/)) {
        const v = part.trim();
        if (v && !out.includes(v)) out.push(v);
      }
    }
    return out;
  }

  /**
   * Firestore rejects `undefined` (including inside maps). Omit `coords` unless both axes are finite numbers.
   * Accepts `lat`/`lng`, `latitude`/`longitude` (e.g. GeoPoint-shaped data from Firestore).
   */
  private coordsField(coords: unknown): { coords: LatLng } | Record<string, never> {
    const ll = this.normalizeLatLng(coords);
    return ll ? { coords: ll } : {};
  }

  private normalizeLatLng(coords: unknown): LatLng | null {
    if (coords == null || typeof coords !== 'object') return null;
    const o = coords as Record<string, unknown>;
    const lat = this.readFiniteNumber(o['lat'] ?? o['latitude']);
    const lng = this.readFiniteNumber(o['lng'] ?? o['longitude']);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  private hasCoordsClose(a: unknown, b: unknown, maxMeters: number): boolean {
    const aa = this.normalizeLatLng(a);
    const bb = this.normalizeLatLng(b);
    if (!aa || !bb) return false;
    return this.haversineMeters(aa, bb) <= maxMeters;
  }

  private async geocodeFromAddress(cityId: string, address: string, nameHint: string): Promise<LatLng | null> {
    const cityLabel = cityId.replace(/[_-]+/g, ' ').trim();
    const endpoint = 'https://nominatim.openstreetmap.org/search';
    const queries = [
      `${nameHint || ''} ${address}, ${cityLabel}`.trim(),
      `${address}, ${cityLabel}`.trim(),
      address.trim(),
    ].filter(Boolean);
    try {
      for (const queryText of queries) {
        const qs = new URLSearchParams({
          format: 'jsonv2',
          limit: '1',
          addressdetails: '0',
          q: queryText,
        });
        const res = await fetch(`${endpoint}?${qs.toString()}`, {
          headers: {
            Accept: 'application/json',
            // Polite identifier for public geocoder usage.
            'X-Requested-With': 'circeco-admin-review',
          },
        });
        if (!res.ok) continue;
        const out = (await res.json()) as Array<{ lat?: string; lon?: string }>;
        const hit = out[0];
        if (!hit) continue;
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        return { lat, lng };
      }
      return null;
    } catch (e) {
      console.warn('[admin-review] geocode failed', { cityId, address, nameHint, e });
      return null;
    }
  }

  private haversineMeters(a: LatLng, b: LatLng): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const q = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  private async detectPlaceConflicts(
    cityId: string,
    candidate: PlaceCandidate
  ): Promise<{ exact: boolean; uncertain: PlaceConflict[] }> {
    const docs = await firstValueFrom(
      collectionData(
        query(
          collection(this.fs, FS_PATHS.places),
          where('cityId', '==', cityId),
          where('status', '==', 'approved'),
          limit(250)
        ),
        { idField: 'id' }
      )
    );
    const candName = this.normalizeText(candidate.name || '');
    const candAddr = this.normalizeAddressText(candidate.address || '');
    const uncertain: PlaceConflict[] = [];
    for (const d of docs as Record<string, unknown>[]) {
      const name = String(d['name'] ?? '');
      const address = String(d['address'] ?? '');
      const nameNorm = this.normalizeText(name);
      const addrNorm = this.normalizeAddressText(address);
      if (!nameNorm) continue;
      if (candName === nameNorm && candAddr && candAddr === addrNorm) {
        return { exact: true, uncertain: [] };
      }
      const coords = this.normalizeLatLng(d['coords']);
      const sameNameDifferentAddress = candName === nameNorm && candAddr !== addrNorm;
      const sameAddressDifferentName = candAddr && candAddr === addrNorm && candName !== nameNorm;
      const nearby = this.hasCoordsClose(candidate.coords, coords, 120);
      if (sameNameDifferentAddress || sameAddressDifferentName || (candName === nameNorm && nearby)) {
        uncertain.push({
          id: String(d['id'] ?? ''),
          name,
          address,
          coords: coords ?? undefined,
          website: typeof d['website'] === 'string' ? d['website'] : '',
          description: typeof d['description'] === 'string' ? d['description'] : '',
          actionTags: Array.isArray(d['actionTags']) ? (d['actionTags'] as string[]) : [],
          sectorCategories: Array.isArray(d['sectorCategories']) ? (d['sectorCategories'] as string[]) : [],
        });
      }
    }
    return { exact: false, uncertain };
  }

  private async enqueueManualPlaceConflictReview(
    cityId: string,
    candidate: PlaceCandidate,
    conflicts: PlaceConflict[]
  ): Promise<void> {
    await this.runWrite('manual:conflict-review', async (batch) => {
      const now = Date.now();
      const fp = this.placeFingerprint(cityId, candidate.name || '', candidate.address || '');
      const newDocId = `manual_${cityId}_${fp}_${now}`;
      batch.set(doc(this.fs, FS_PATHS.reviewQueue, newDocId), {
        kind: 'place',
        cityId,
        status: 'needs_review',
        confidence: 0.55,
        candidate: {
          name: candidate.name,
          address: candidate.address,
          locationName: candidate.locationName ?? '',
          ...this.coordsField(candidate.coords),
          website: candidate.website ?? '',
          description: candidate.description ?? '',
          sectorCategories: candidate.sectorCategories ?? [],
          actionTags: (candidate.actionTags ?? []) as string[],
        },
        evidence: [
          {
            url: 'manual://admin-review',
            snippet: 'Manual place added; possible duplicate detected',
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: conflicts.map((c) => ({
          collection: 'places',
          id: c.id,
          reason: 'possible_duplicate',
          confidence: 0.55,
        })),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      for (const c of conflicts) {
        const existingDocId = `manual_recheck_${cityId}_${c.id}_${now}`;
        batch.set(doc(this.fs, FS_PATHS.reviewQueue, existingDocId), {
          kind: 'place',
          cityId,
          status: 'needs_review',
          confidence: 0.55,
          candidate: {
            name: c.name,
            address: c.address,
            ...this.coordsField(c.coords),
            website: c.website ?? '',
            description: c.description ?? '',
            sectorCategories: c.sectorCategories ?? [],
            actionTags: c.actionTags ?? [],
          },
          evidence: [
            {
              url: 'manual://admin-review',
              snippet: `Existing approved place flagged by manual add (${candidate.name || 'new place'})`,
              capturedAt: new Date().toISOString(),
            },
          ],
          matchCandidates: [],
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      }
    });
  }

  private readFiniteNumber(v: unknown): number | null {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  private evidenceToSourceRefs(row: ReviewQueuePlaceRow | ReviewQueueEventRow, preferredUrl?: string | null) {
    const refs = (row.evidence || []).map((e) => ({
      sourceType: 'website' as const,
      url: e.url,
      retrievedAt: e.capturedAt,
    }));
    const preferred = String(preferredUrl || '').trim();
    if (preferred && !refs.some((r) => r.url === preferred)) {
      refs.unshift({
        sourceType: 'website' as const,
        url: preferred,
        retrievedAt: new Date().toISOString(),
      });
    }
    return refs;
  }

  private manualSourceRefs(preferredUrl?: string): Array<{ sourceType: 'website'; url: string; retrievedAt: string }> {
    const url = String(preferredUrl || '').trim();
    if (!url) return [];
    return [{
      sourceType: 'website',
      url,
      retrievedAt: new Date().toISOString(),
    }];
  }

  private async persistReviewMemoryLearning(
    entries: Array<{
      cityId: string;
      candidate: Partial<PlaceCandidate>;
      decision: DecisionType;
      reviewedAtIso: string;
    }>
  ): Promise<void> {
    if (!entries.length) return;
    try {
      const batch = writeBatch(this.fs);
      const nameIndexDeltas = new Map<string, NameIndexDelta>();
      const nameGeoIndexDeltas = new Map<string, NameGeoIndexDelta>();
      const rollupDeltas = new Map<string, RollupDelta>();
      for (const entry of entries) {
        batch.set(
          doc(this.fs, FS_PATHS.reviewMemory, this.reviewMemoryDocId(entry.cityId, entry.candidate)),
          this.reviewMemoryPayload(entry.cityId, entry.candidate, entry.decision, entry.reviewedAtIso),
          { merge: true }
        );
        this.collectReviewMemoryIndexDeltas(
          entry.cityId,
          entry.candidate,
          entry.decision,
          entry.reviewedAtIso,
          nameIndexDeltas,
          nameGeoIndexDeltas,
          rollupDeltas
        );
      }
      for (const delta of nameIndexDeltas.values()) {
        batch.set(
          doc(this.fs, FS_PATHS.reviewMemoryNameIndex, delta.docId),
          {
            cityId: delta.cityId,
            nameNorm: delta.nameNorm,
            keyType: 'name',
            lastDecision: delta.lastDecision,
            lastReviewedAt: delta.lastReviewedAt,
            approvedCount: increment(delta.approvedInc),
            rejectedCount: increment(delta.rejectedInc),
            expiresAt: delta.expiresAt ?? deleteField(),
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const delta of nameGeoIndexDeltas.values()) {
        batch.set(
          doc(this.fs, FS_PATHS.reviewMemoryNameGeoIndex, delta.docId),
          {
            cityId: delta.cityId,
            nameNorm: delta.nameNorm,
            geoBucket: delta.geoBucket,
            keyType: 'name_geo',
            lastDecision: delta.lastDecision,
            lastReviewedAt: delta.lastReviewedAt,
            approvedCount: increment(delta.approvedInc),
            rejectedCount: increment(delta.rejectedInc),
            expiresAt: delta.expiresAt ?? deleteField(),
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const delta of rollupDeltas.values()) {
        batch.set(
          doc(this.fs, FS_PATHS.reviewMemoryRollups, delta.cityId),
          {
            cityId: delta.cityId,
            indexedCount: increment(delta.indexedInc),
            approvedCount: increment(delta.approvedInc),
            rejectedCount: increment(delta.rejectedInc),
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    } catch (e) {
      // Keep moderation action successful even if optional learning/index writes fail.
      console.warn('[admin-review] review memory learning write failed', e);
    }
  }

  private async persistEventReviewMemoryLearning(
    entries: Array<{
      cityId: string;
      candidate: Partial<EventCandidate>;
      decision: DecisionType;
      reviewedAtIso: string;
      alsoSeries?: boolean;
      sourceUrlHint?: string;
    }>
  ): Promise<void> {
    if (!entries.length) return;
    try {
      const batch = writeBatch(this.fs);
      const titleIndexDeltas = new Map<string, EventTitleIndexDelta>();
      const sourceDeltas = new Map<string, EventSourceMemoryDelta>();
      const rollupDeltas = new Map<string, RollupDelta>();
      for (const entry of entries) {
        const forceSeries =
          !!entry.alsoSeries || !!(entry.candidate.recurrence && entry.candidate.recurrence.frequency !== 'none');
        const hasDate = !!String(entry.candidate.startDate || '').trim();

        if (hasDate) {
          batch.set(
            doc(
              this.fs,
              FS_PATHS.eventReviewMemory,
              this.eventReviewMemoryDocId(entry.cityId, entry.candidate, false)
            ),
            this.eventReviewMemoryPayload(
              entry.cityId,
              entry.candidate,
              entry.decision,
              entry.reviewedAtIso,
              false,
              entry.sourceUrlHint
            ),
            { merge: true }
          );
        }
        if (forceSeries || !hasDate) {
          batch.set(
            doc(
              this.fs,
              FS_PATHS.eventReviewMemory,
              this.eventReviewMemoryDocId(entry.cityId, entry.candidate, true)
            ),
            this.eventReviewMemoryPayload(
              entry.cityId,
              entry.candidate,
              entry.decision,
              entry.reviewedAtIso,
              true,
              entry.sourceUrlHint
            ),
            { merge: true }
          );
        }
        this.collectEventReviewMemoryIndexDeltas(
          entry.cityId,
          entry.candidate,
          entry.decision,
          entry.reviewedAtIso,
          titleIndexDeltas,
          sourceDeltas,
          rollupDeltas,
          entry.sourceUrlHint
        );
      }
      for (const delta of titleIndexDeltas.values()) {
        const titlePayload: Record<string, unknown> = {
          cityId: delta.cityId,
          titleNorm: delta.titleNorm,
          keyType: 'title',
          lastDecision: delta.lastDecision,
          lastReviewedAt: delta.lastReviewedAt,
          approvedCount: increment(delta.approvedInc),
          rejectedCount: increment(delta.rejectedInc),
          expiresAt: delta.expiresAt ?? deleteField(),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        };
        if (delta.approvalSignals) {
          titlePayload['approvalSignals'] = delta.approvalSignals;
        }
        batch.set(doc(this.fs, FS_PATHS.eventReviewMemoryTitleIndex, delta.docId), titlePayload, { merge: true });
      }
      for (const delta of sourceDeltas.values()) {
        batch.set(
          doc(this.fs, FS_PATHS.eventReviewMemory, delta.docId),
          {
            cityId: delta.cityId,
            kind: 'source',
            sourceHost: delta.sourceHost,
            lastDecision: delta.lastDecision,
            lastReviewedAt: delta.lastReviewedAt,
            approvedCount: increment(delta.approvedInc),
            rejectedCount: increment(delta.rejectedInc),
            expiresAt: delta.expiresAt ?? deleteField(),
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const delta of rollupDeltas.values()) {
        batch.set(
          doc(this.fs, FS_PATHS.eventReviewMemoryRollups, delta.cityId),
          {
            cityId: delta.cityId,
            indexedCount: increment(delta.indexedInc),
            approvedCount: increment(delta.approvedInc),
            rejectedCount: increment(delta.rejectedInc),
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    } catch (e) {
      console.warn('[admin-review] event review memory learning write failed', e);
    }
  }

  private collectEventReviewMemoryIndexDeltas(
    cityId: string,
    candidate: Partial<EventCandidate>,
    decision: DecisionType,
    reviewedAtIso: string,
    titleIndexDeltas: Map<string, EventTitleIndexDelta>,
    sourceDeltas: Map<string, EventSourceMemoryDelta>,
    rollupDeltas: Map<string, RollupDelta>,
    sourceUrlHint = ''
  ): void {
    const titleNorm = this.normalizeText(candidate.title || '');
    if (!titleNorm) return;
    const approvedInc = decision === 'approved' ? 1 : 0;
    const rejectedInc = decision === 'rejected' ? 1 : 0;
    const expiresAt = this.memoryExpiry(decision, reviewedAtIso);
    const titleDocId = this.eventReviewMemoryTitleIndexDocId(cityId, titleNorm);
    const titleDelta = titleIndexDeltas.get(titleDocId) ?? {
      docId: titleDocId,
      cityId,
      titleNorm,
      approvedInc: 0,
      rejectedInc: 0,
      lastDecision: decision,
      lastReviewedAt: reviewedAtIso,
      expiresAt,
      approvalSignals: null,
    };
    titleDelta.approvedInc += approvedInc;
    titleDelta.rejectedInc += rejectedInc;
    titleDelta.lastDecision = decision;
    titleDelta.lastReviewedAt = reviewedAtIso;
    titleDelta.expiresAt = decision === 'approved' ? null : expiresAt;
    if (decision === 'approved') {
      titleDelta.approvalSignals = this.buildEventApprovalSignals(candidate);
    }
    titleIndexDeltas.set(titleDocId, titleDelta);

    const host =
      this.hostFromUrl(candidate.website || '') || this.hostFromUrl(sourceUrlHint || '');
    if (host) {
      const sourceDocId = this.eventReviewMemorySourceDocId(cityId, host);
      const sourceDelta = sourceDeltas.get(sourceDocId) ?? {
        docId: sourceDocId,
        cityId,
        sourceHost: host,
        approvedInc: 0,
        rejectedInc: 0,
        lastDecision: decision,
        lastReviewedAt: reviewedAtIso,
        expiresAt,
      };
      sourceDelta.approvedInc += approvedInc;
      sourceDelta.rejectedInc += rejectedInc;
      sourceDelta.lastDecision = decision;
      sourceDelta.lastReviewedAt = reviewedAtIso;
      sourceDelta.expiresAt = decision === 'approved' ? null : expiresAt;
      sourceDeltas.set(sourceDocId, sourceDelta);
    }

    const rollup = rollupDeltas.get(cityId) ?? {
      cityId,
      indexedInc: 0,
      approvedInc: 0,
      rejectedInc: 0,
    };
    rollup.indexedInc += 1;
    rollup.approvedInc += approvedInc;
    rollup.rejectedInc += rejectedInc;
    rollupDeltas.set(cityId, rollup);
  }

  private eventReviewMemoryPayload(
    cityId: string,
    candidate: Partial<EventCandidate>,
    decision: DecisionType,
    reviewedAtIso: string,
    asSeries = false,
    sourceUrlHint = ''
  ): Record<string, unknown> {
    const titleNorm = this.normalizeText(candidate.title || '');
    const locationNorm = this.normalizeText(candidate.locationText || candidate.address || '');
    const startDate = asSeries ? '' : String(candidate.startDate || '').trim();
    const sourceHost =
      this.hostFromUrl(candidate.website || '') || this.hostFromUrl(sourceUrlHint || '');
    const payload: Record<string, unknown> = {
      cityId,
      kind: 'event',
      fingerprint: this.eventFingerprint(cityId, candidate.title || '', startDate || 'series', locationNorm),
      eventKey: `${cityId}|${titleNorm}|${startDate || 'series'}|${locationNorm}`,
      titleNorm,
      locationNorm,
      startDate: startDate || null,
      series: asSeries,
      recurrenceFrequency: candidate.recurrence?.frequency || 'none',
      lastDecision: decision,
      lastReviewedAt: reviewedAtIso,
      approvedCount: increment(decision === 'approved' ? 1 : 0),
      rejectedCount: increment(decision === 'rejected' ? 1 : 0),
      expiresAt: this.memoryExpiry(decision, reviewedAtIso) ?? deleteField(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    if (sourceHost) payload['sourceHost'] = sourceHost;
    if (decision === 'approved') {
      payload['approvalSignals'] = this.buildEventApprovalSignals(candidate);
    }
    if (decision === 'rejected') {
      payload['rejectionSignals'] = {
        actionTags: (candidate.actionTags ?? []) as string[],
        sectorCategories: candidate.sectorCategories ?? [],
      };
    }
    return payload;
  }

  private buildEventApprovalSignals(candidate: Partial<EventCandidate>): {
    actionTags: string[];
    sectorCategories: string[];
    keywords: string[];
  } {
    const keywords = this.extractLearningKeywords(
      `${candidate.title || ''} ${candidate.description || ''}`,
      8
    );
    return {
      actionTags: (candidate.actionTags ?? []).map(String).slice(0, 6),
      sectorCategories: (candidate.sectorCategories ?? []).map(String).slice(0, 6),
      keywords,
    };
  }

  private extractLearningKeywords(text: string, limit = 8): string[] {
    const raw = this.normalizeText(text);
    if (!raw) return [];
    const stop = new Set([
      'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'have', 'has',
      'dell', 'della', 'delle', 'degli', 'una', 'uno', 'per', 'con', 'che', 'non', 'come',
      'och', 'att', 'som', 'det', 'den', 'ett', 'med', 'pa', 'av',
    ]);
    const out: string[] = [];
    for (const token of raw.split(' ')) {
      if (token.length < 4 || stop.has(token)) continue;
      if (!out.includes(token)) out.push(token);
      if (out.length >= limit) break;
    }
    return out;
  }

  private hostFromUrl(url: string): string {
    try {
      return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  private eventReviewMemoryDocId(
    cityId: string,
    candidate: Partial<EventCandidate>,
    asSeries = false
  ): string {
    const locationNorm = this.normalizeText(candidate.locationText || candidate.address || '');
    const startDate = asSeries ? 'series' : String(candidate.startDate || '').trim();
    const fp = this.eventFingerprint(cityId, candidate.title || '', startDate, locationNorm);
    return `${cityId}_${fp}`;
  }

  private eventReviewMemoryTitleIndexDocId(cityId: string, titleNorm: string): string {
    return `${cityId}_${this.hashString(`eventtitle|${titleNorm}`)}`;
  }

  private eventReviewMemorySourceDocId(cityId: string, host: string): string {
    const h = String(host || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .trim();
    return `${cityId}_source_${this.hashString(h)}`;
  }

  private eventFingerprint(cityId: string, title: string, startDate: string, locationNorm: string): string {
    return this.hashString(`${cityId}|${this.normalizeText(title)}|${String(startDate || '').trim()}|${locationNorm}`);
  }

  private collectReviewMemoryIndexDeltas(
    cityId: string,
    candidate: Partial<PlaceCandidate>,
    decision: DecisionType,
    reviewedAtIso: string,
    nameIndexDeltas: Map<string, NameIndexDelta>,
    nameGeoIndexDeltas: Map<string, NameGeoIndexDelta>,
    rollupDeltas: Map<string, RollupDelta>
  ): void {
    const nameNorm = this.normalizeText(candidate.name || '');
    if (!nameNorm) return;
    const approvedInc = decision === 'approved' ? 1 : 0;
    const rejectedInc = decision === 'rejected' ? 1 : 0;
    const expiresAt = this.memoryExpiry(decision, reviewedAtIso);
    const nameDocId = this.reviewMemoryNameIndexDocId(cityId, nameNorm);
    const nameDelta = nameIndexDeltas.get(nameDocId) ?? {
      docId: nameDocId,
      cityId,
      nameNorm,
      approvedInc: 0,
      rejectedInc: 0,
      lastDecision: decision,
      lastReviewedAt: reviewedAtIso,
      expiresAt,
    };
    nameDelta.approvedInc += approvedInc;
    nameDelta.rejectedInc += rejectedInc;
    nameDelta.lastDecision = decision;
    nameDelta.lastReviewedAt = reviewedAtIso;
    nameDelta.expiresAt = decision === 'approved' ? null : expiresAt;
    nameIndexDeltas.set(nameDocId, nameDelta);

    const bucket = this.geoBucket(candidate.coords);
    if (bucket) {
      const nameGeoDocId = this.reviewMemoryNameGeoIndexDocId(cityId, nameNorm, bucket);
      const nameGeoDelta = nameGeoIndexDeltas.get(nameGeoDocId) ?? {
        docId: nameGeoDocId,
        cityId,
        nameNorm,
        geoBucket: bucket,
        approvedInc: 0,
        rejectedInc: 0,
        lastDecision: decision,
        lastReviewedAt: reviewedAtIso,
        expiresAt,
      };
      nameGeoDelta.approvedInc += approvedInc;
      nameGeoDelta.rejectedInc += rejectedInc;
      nameGeoDelta.lastDecision = decision;
      nameGeoDelta.lastReviewedAt = reviewedAtIso;
      nameGeoDelta.expiresAt = decision === 'approved' ? null : expiresAt;
      nameGeoIndexDeltas.set(nameGeoDocId, nameGeoDelta);
    }

    const rollup = rollupDeltas.get(cityId) ?? {
      cityId,
      indexedInc: 0,
      approvedInc: 0,
      rejectedInc: 0,
    };
    rollup.indexedInc += 1;
    rollup.approvedInc += approvedInc;
    rollup.rejectedInc += rejectedInc;
    rollupDeltas.set(cityId, rollup);
  }

  private memoryExpiry(decision: DecisionType, reviewedAtIso: string): string | null {
    if (decision !== 'rejected') return null;
    const base = Date.parse(reviewedAtIso);
    if (!isFinite(base)) return null;
    const ms = this.rejectOnlyRetentionDays * 24 * 60 * 60 * 1000;
    return new Date(base + ms).toISOString();
  }

  private reviewMemoryPayload(
    cityId: string,
    candidate: Partial<PlaceCandidate>,
    decision: DecisionType,
    reviewedAtIso: string
  ): Record<string, unknown> {
    const nameNorm = this.normalizeText(candidate.name || '');
    const addressNorm = this.normalizeAddressText(candidate.address || '');
    const payload: Record<string, unknown> = {
      cityId,
      fingerprint: this.placeFingerprint(cityId, candidate.name || '', candidate.address || ''),
      placeKey: `${cityId}|${nameNorm}|${addressNorm}`,
      nameNorm,
      addressNorm,
      geoBucket: this.geoBucket(candidate.coords),
      lastDecision: decision,
      lastReviewedAt: reviewedAtIso,
      approvedCount: increment(decision === 'approved' ? 1 : 0),
      rejectedCount: increment(decision === 'rejected' ? 1 : 0),
      expiresAt: this.memoryExpiry(decision, reviewedAtIso) ?? deleteField(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    if (decision === 'rejected') {
      payload['rejectionSignals'] = {
        actionTags: (candidate.actionTags ?? []) as string[],
        sectorCategories: candidate.sectorCategories ?? [],
      };
    }
    return payload;
  }

  private reviewMemoryDocId(cityId: string, candidate: Partial<PlaceCandidate>): string {
    const fp = this.placeFingerprint(cityId, candidate.name || '', candidate.address || '');
    return `${cityId}_${fp}`;
  }

  private reviewMemoryNameIndexDocId(cityId: string, nameNorm: string): string {
    return `${cityId}_${this.hashString(`name|${nameNorm}`)}`;
  }

  private reviewMemoryNameGeoIndexDocId(cityId: string, nameNorm: string, geoBucket: string): string {
    return `${cityId}_${this.hashString(`namegeo|${nameNorm}|${geoBucket}`)}`;
  }

  private placeFingerprint(cityId: string, name: string, address: string): string {
    return this.hashString(`${cityId}|${this.normalizeText(name)}|${this.normalizeAddressText(address)}`);
  }

  private normalizeText(v: unknown): string {
    return String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private normalizeAddressDisplay(v: unknown): string {
    const raw = String(v || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .trim();
    if (!raw) return '';
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0];
    const m = first.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
    if (m) parts[0] = `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ');
    return parts.join(', ');
  }

  private normalizeAddressText(v: unknown): string {
    const display = this.normalizeAddressDisplay(v)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!display) return '';
    const m = display.match(/^(\d+[a-z]?)\s+(.+)$/i);
    if (m) return `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ');
    return display;
  }

  private hashString(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h >>> 0) * 0x01000193;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  private geoBucket(coords: unknown): string {
    const ll = this.normalizeLatLng(coords);
    if (!ll) return '';
    return `${ll.lat.toFixed(3)},${ll.lng.toFixed(3)}`;
  }

  private async runSingleOp(opId: string, fn: () => Promise<void>): Promise<void> {
    this.lastError.set(null);
    const busy = new Set(this.busyIds());
    busy.add(opId);
    this.busyIds.set(busy);
    try {
      await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError.set(msg);
      console.error('[admin-review]', e);
    } finally {
      const next = new Set(this.busyIds());
      next.delete(opId);
      this.busyIds.set(next);
    }
  }

  private async runWrite(queueId: string, fn: (batch: ReturnType<typeof writeBatch>) => void | Promise<void>): Promise<void> {
    this.lastError.set(null);
    const busy = new Set(this.busyIds());
    busy.add(queueId);
    this.busyIds.set(busy);
    try {
      const batch = writeBatch(this.fs);
      await fn(batch);
      await batch.commit();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError.set(msg);
      console.error('[admin-review]', e);
    } finally {
      const next = new Set(this.busyIds());
      next.delete(queueId);
      this.busyIds.set(next);
    }
  }
}
