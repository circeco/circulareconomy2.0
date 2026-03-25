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
import { serverTimestamp } from 'firebase/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { map, shareReplay, catchError, tap } from 'rxjs/operators';

import { FS_PATHS } from '../../data/firestore-paths';
import type {
  EventCandidate,
  LatLng,
  PlaceCandidate,
  ReviewQueueEventDoc,
  ReviewQueuePlaceDoc,
} from '../../data/models';

type ReviewQueuePlaceRow = ReviewQueuePlaceDoc & { id: string };
type ReviewQueueEventRow = ReviewQueueEventDoc & { id: string };

/** Flat form for editing an event candidate in the UI */
export interface EventEditForm {
  title: string;
  startDate: string;
  endDate: string;
  locationText: string;
  address: string;
  description: string;
  timeDisplay: string;
  imageUrl: string;
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

  readonly placeQueue$: Observable<ReviewQueuePlaceRow[]>;
  readonly eventQueue$: Observable<ReviewQueueEventRow[]>;

  readonly busyIds = signal<Set<string>>(new Set());
  readonly lastError = signal<string | null>(null);

  /** Row id whose event editor is open (one at a time per kind) */
  editingEventRowId: string | null = null;
  eventEdit: EventEditForm | null = null;

  editingPlaceRowId: string | null = null;
  placeEdit: PlaceEditForm | null = null;

  constructor() {
    const col = collection(this.fs, FS_PATHS.reviewQueue);
    const q = query(col, where('status', '==', 'needs_review'), limit(100));
    const queue$ = collectionData(q, { idField: 'id' }).pipe(
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
      }),
      shareReplay(1)
    );
    this.placeQueue$ = queue$.pipe(map((x) => x.places));
    this.eventQueue$ = queue$.pipe(map((x) => x.events));
  }

  toggleEventEdit(row: ReviewQueueEventRow): void {
    if (this.editingEventRowId === row.id) {
      this.editingEventRowId = null;
      this.eventEdit = null;
      return;
    }
    this.closePlaceEditor();
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
  }

  async approvePlace(row: ReviewQueuePlaceRow): Promise<void> {
    const c = this.mergedPlaceCandidate(row);
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
        review: { reviewedAt: new Date().toISOString() },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        status: 'approved',
        publishedRef: { collection: 'places', id: newRef.id },
        review: { reviewedAt: new Date().toISOString() },
        updatedAt: serverTimestamp(),
      });
    });
    this.closeEditorsForRow(row.id);
  }

  async rejectPlace(row: ReviewQueuePlaceRow): Promise<void> {
    await this.runWrite(row.id, async (batch) => {
      batch.update(doc(this.fs, FS_PATHS.reviewQueue, row.id), {
        status: 'rejected',
        review: { reviewedAt: new Date().toISOString() },
        updatedAt: serverTimestamp(),
      });
    });
    this.closeEditorsForRow(row.id);
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
      description: c.description ?? '',
      timeDisplay: c.timeDisplay ?? '',
      imageUrl: c.imageUrl ?? '',
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
      address: f.address.trim(),
      description: f.description.trim(),
      timeDisplay: f.timeDisplay.trim(),
      imageUrl: f.imageUrl.trim(),
      sectorCategories: this.splitCsv(f.sectorCategoriesText),
      actionTags: this.splitCsv(f.actionTagsText) as EventCandidate['actionTags'],
    };
  }

  private placeFormToCandidate(f: PlaceEditForm): Partial<PlaceCandidate> {
    const lat = parseFloat(f.latStr.trim());
    const lng = parseFloat(f.lngStr.trim());
    const base: Partial<PlaceCandidate> = {
      name: f.name.trim(),
      address: f.address.trim(),
      description: f.description.trim(),
      website: f.website.trim(),
      locationName: f.locationName.trim(),
      sectorCategories: this.splitCsv(f.sectorCategoriesText),
      actionTags: this.splitCsv(f.actionTagsText) as PlaceCandidate['actionTags'],
    };
    if (isFinite(lat) && isFinite(lng)) {
      base.coords = { lat, lng };
    }
    return base;
  }

  private splitCsv(s: string): string[] {
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
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
