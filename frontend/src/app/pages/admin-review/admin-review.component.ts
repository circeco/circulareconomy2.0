import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, shareReplay, catchError, tap } from 'rxjs/operators';

import { FS_PATHS } from '../../data/firestore-paths';
import { CityContextService } from '../../services/city-context.service';
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
  startDate: string;
  endDate: string;
  locationText: string;
  address: string;
  website: string;
  description: string;
  timeDisplay: string;
  sectorCategoriesText: string;
  actionTagsText: string;
}

/** Flat form for editing a place candidate */
export interface PlaceEditForm {
  name: string;
  address: string;
  description: string;
  website: string;
  locationName: string;
  sectorCategoriesText: string;
  actionTagsText: string;
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
  private readonly rejectOnlyRetentionDays = 180;

  readonly placeQueue$: Observable<ReviewQueuePlaceRow[]>;
  readonly eventQueue$: Observable<ReviewQueueEventRow[]>;
  readonly placeRows = signal<ReviewQueuePlaceRow[]>([]);

  readonly busyIds = signal<Set<string>>(new Set());
  readonly lastError = signal<string | null>(null);
  readonly rejectSimilarByRowId = signal<Record<string, boolean>>({});

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
    const col = collection(this.fs, FS_PATHS.reviewQueue);
    const q = query(col, where('status', '==', 'needs_review'), limit(100));
    const rawQueue$ = collectionData(q, { idField: 'id' }).pipe(
      map((docs: Record<string, unknown>[]) => [...docs].sort(
          (a, b) => Number(b['confidence'] ?? 0) - Number(a['confidence'] ?? 0)
        )
      ),
      tap(() => this.lastError.set(null)),
      catchError((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastError.set(msg);
        return of([] as Record<string, unknown>[]);
      }),
      shareReplay(1)
    );
    const queue$ = combineLatest([rawQueue$, this.cityContext.cityId$]).pipe(
      map(([docs, cityId]) => {
        const scoped = docs.filter((d) => String(d['cityId'] || '') === cityId);
        const places = scoped.filter((d) => d['kind'] === 'place') as unknown as ReviewQueuePlaceRow[];
        const events = scoped.filter((d) => d['kind'] === 'event') as unknown as ReviewQueueEventRow[];
        return { places, events };
      }),
      shareReplay(1)
    );
    this.placeQueue$ = queue$.pipe(map((x) => x.places));
    this.eventQueue$ = queue$.pipe(map((x) => x.events));
    this.placeQueue$.subscribe((rows) => this.placeRows.set(rows));
  }

  toggleEventEdit(row: ReviewQueueEventRow): void {
    if (this.editingEventRowId === row.id) {
      this.editingEventRowId = null;
      this.eventEdit = null;
      return;
    }
    this.closePlaceEditor();
    this.cancelCreateEvent();
    this.cancelCreatePlace();
    this.editingEventRowId = row.id;
    this.eventEdit = this.buildEventForm(row.candidate);
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

  async saveEventDraft(row: ReviewQueueEventRow): Promise<void> {
    if (!this.eventEdit || this.editingEventRowId !== row.id) return;
    const candidate = this.eventFormToCandidate(this.eventEdit);
    await this.runSingleOp(`${row.id}:save-event`, () =>
      updateDoc(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        candidate: { ...row.candidate, ...candidate },
        updatedAt: serverTimestamp(),
      })
    );
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
    if (!c.title || !c.startDate || !c.locationText) {
      this.lastError.set('Event requires title, start date, and location.');
      return;
    }
    const cityId = this.cityContext.cityId();
    const reviewedAt = new Date().toISOString();
    await this.runWrite('manual:add-event', async (batch) => {
      const newRef = doc(collection(this.fs, FS_PATHS.events));
      batch.set(newRef, {
        cityId,
        title: c.title,
        startDate: c.startDate,
        endDate: c.endDate || c.startDate,
        locationText: c.locationText,
        address: c.address ?? '',
        locationName: c.locationName ?? '',
        ...this.coordsField(c.coords),
        website: c.website ?? '',
        description: c.description ?? '',
        timeDisplay: c.timeDisplay ?? '',
        imageUrl: c.imageUrl ?? '',
        sectorCategories: c.sectorCategories ?? [],
        actionTags: (c.actionTags ?? []) as string[],
        sourceRefs: [],
        status: 'approved',
        review: { reviewedAt },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
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

  async approveEvent(row: ReviewQueueEventRow): Promise<void> {
    const c = this.mergedEventCandidate(row);
    await this.runWrite(row.id, async (batch) => {
      const newRef = doc(collection(this.fs, FS_PATHS.events));
      batch.set(newRef, {
        cityId: row.cityId,
        title: c.title,
        startDate: c.startDate,
        endDate: c.endDate || c.startDate,
        locationText: c.locationText,
        address: c.address ?? '',
        locationName: c.locationName ?? '',
        ...this.coordsField(c.coords),
        website: c.website ?? '',
        description: c.description ?? '',
        timeDisplay: c.timeDisplay ?? '',
        imageUrl: c.imageUrl ?? '',
        sectorCategories: c.sectorCategories ?? [],
        actionTags: (c.actionTags ?? []) as string[],
        sourceRefs: this.evidenceToSourceRefs(row),
        status: 'approved',
        review: { reviewedAt: new Date().toISOString() },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        status: 'approved',
        publishedRef: { collection: 'events', id: newRef.id },
        review: { reviewedAt: new Date().toISOString() },
        updatedAt: serverTimestamp(),
      });
    });
    this.closeEditorsForRow(row.id);
  }

  async rejectEvent(row: ReviewQueueEventRow): Promise<void> {
    await this.runWrite(row.id, async (batch) => {
      batch.update(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        status: 'rejected',
        review: { reviewedAt: new Date().toISOString() },
        updatedAt: serverTimestamp(),
      });
    });
    this.closeEditorsForRow(row.id);
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  cityId(): string {
    return this.cityContext.cityId();
  }

  private mergedEventCandidate(row: ReviewQueueEventRow): EventCandidate {
    if (this.editingEventRowId === row.id && this.eventEdit) {
      return { ...row.candidate, ...this.eventFormToCandidate(this.eventEdit) };
    }
    return row.candidate;
  }

  private mergedPlaceCandidate(row: ReviewQueuePlaceRow): PlaceCandidate {
    if (this.editingPlaceRowId === row.id && this.placeEdit) {
      return { ...row.candidate, ...this.placeFormToCandidate(this.placeEdit) };
    }
    return row.candidate;
  }

  private buildEventForm(c: EventCandidate): EventEditForm {
    return {
      title: c.title ?? '',
      startDate: c.startDate ?? '',
      endDate: (c.endDate ?? c.startDate) ?? '',
      locationText: c.locationText ?? '',
      address: c.address ?? '',
      website: c.website ?? '',
      description: c.description ?? '',
      timeDisplay: c.timeDisplay ?? '',
      sectorCategoriesText: (c.sectorCategories ?? []).join(', '),
      actionTagsText: (c.actionTags ?? []).join(', '),
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
      sectorCategoriesText: (c.sectorCategories ?? []).join(', '),
      actionTagsText: (c.actionTags ?? []).join(', '),
      latStr: lat != null && isFinite(lat) ? String(lat) : '',
      lngStr: lng != null && isFinite(lng) ? String(lng) : '',
    };
  }

  private eventFormToCandidate(f: EventEditForm): Partial<EventCandidate> {
    const start = f.startDate.trim();
    const end = f.endDate.trim() || start;
    return {
      title: f.title.trim(),
      startDate: start,
      endDate: end,
      locationText: f.locationText.trim(),
      address: this.normalizeAddressDisplay(f.address),
      website: f.website.trim(),
      description: f.description.trim(),
      timeDisplay: f.timeDisplay.trim(),
      sectorCategories: this.normalizeSectorCategories(this.splitCsv(f.sectorCategoriesText)),
      actionTags: this.splitCsv(f.actionTagsText) as EventCandidate['actionTags'],
    };
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
      sectorCategories: this.normalizeSectorCategories(this.splitCsv(f.sectorCategoriesText)),
      actionTags: this.splitCsv(f.actionTagsText) as PlaceCandidate['actionTags'],
    };
    if (isFinite(lat) && isFinite(lng)) {
      base.coords = { lat, lng };
    }
    return base;
  }

  private splitCsv(s: string): string[] {
    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  private normalizeSectorCategories(values: string[]): string[] {
    const allowed = new Set([
      'books',
      'music',
      'electronics',
      'clothing',
      'accessories',
      'furniture',
      'antiques',
      'sport',
    ]);
    const out: string[] = [];
    for (const raw of values) {
      const v = String(raw || '').toLowerCase().trim();
      if (allowed.has(v) && !out.includes(v)) out.push(v);
    }
    return out;
  }

  displayActionTags(values: string[] | undefined): string[] {
    return this.expandDelimited(values);
  }

  displaySectorCategories(values: string[] | undefined): string[] {
    const allowed = new Set([
      'books',
      'music',
      'electronics',
      'clothing',
      'accessories',
      'furniture',
      'antiques',
      'sport',
    ]);
    return this.expandDelimited(values)
      .map((v) => v.replace(/^shop:/, '').replace(/^amenity:/, '').replace(/^craft:/, ''))
      .filter((v) => allowed.has(v));
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

  private evidenceToSourceRefs(row: ReviewQueuePlaceRow | ReviewQueueEventRow) {
    return (row.evidence || []).map((e) => ({
      sourceType: 'website' as const,
      url: e.url,
      retrievedAt: e.capturedAt,
    }));
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
