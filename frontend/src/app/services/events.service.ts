import { inject, Injectable } from '@angular/core';
import { Firestore, collection, limit, query, where } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FS_PATHS } from '../data/firestore-paths';
import { CityContextService } from './city-context.service';
import { canonicalizeActionTag, canonicalizeActionTags, canonicalizeSectorCategories } from '../data/taxonomy';
import { formatEventDateLabel, recurrenceLabel, type EventRecurrence } from '../data/event-recurrence';

export interface EventItem {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  website: string;
  time: string;
  image: string;
  date: Date;
  dateStr: string;
  actionTags: string[];
  sectorCategories: string[];
  recurrence?: EventRecurrence;
  recurrenceLabel: string;
}

const DEFAULT_EVENT_IMAGE =
  'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=400&h=300&fit=crop';

@Injectable({ providedIn: 'root' })
export class EventsService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);

  readonly events$: Observable<EventItem[]> = this.cityContext.cityId$.pipe(
    switchMap((cityId) =>
      collectionData(
        query(
          collection(this.fs, FS_PATHS.events),
          where('status', '==', 'approved'),
          where('cityId', '==', cityId),
          limit(250)
        ),
        { idField: 'id' }
      ).pipe(
        map((docs: Record<string, unknown>[]) => {
          return docs.map((d) => this.firestoreDocToEventItem(d)).filter((e): e is EventItem => !!e);
        }),
        catchError((err) => {
          console.warn('[events] Firestore read failed', err);
          return of([]);
        })
      )
    )
  );

  getEvents(): EventItem[] {
    return [];
  }

  getEventById(_id: string): EventItem | undefined {
    return undefined;
  }

  private firestoreDocToEventItem(d: Record<string, unknown>): EventItem | null {
    const id = String(d['id'] ?? '');
    const title = String(d['title'] ?? '');
    const startDate = d['startDate'];
    if (!id || !title || typeof startDate !== 'string') return null;

    const date = this.parseIsoDateLocal(startDate);
    if (isNaN(date.getTime())) return null;

    const tags = canonicalizeActionTags(Array.isArray(d['actionTags']) ? (d['actionTags'] as string[]) : []);
    const sectors = canonicalizeSectorCategories(Array.isArray(d['sectorCategories']) ? (d['sectorCategories'] as string[]) : []);
    const category = this.pickUiCategory(tags, sectors);
    const time = String(d['timeDisplay'] ?? '').trim();
    const recurrence = this.parseRecurrence(d['recurrence']);
    const dateStr = formatEventDateLabel(startDate);
    const dateTimeLabel = time ? `${dateStr} · ${time}` : dateStr;

    return {
      id,
      title,
      description: String(d['description'] ?? ''),
      category,
      location: String(d['address'] || d['locationText'] || ''),
      website: String(d['website'] ?? '').trim(),
      time,
      image: typeof d['imageUrl'] === 'string' && d['imageUrl'] ? String(d['imageUrl']) : DEFAULT_EVENT_IMAGE,
      date,
      dateStr: dateTimeLabel,
      actionTags: tags,
      sectorCategories: sectors,
      recurrence,
      recurrenceLabel: recurrenceLabel(recurrence, startDate),
    };
  }

  private parseRecurrence(raw: unknown): EventRecurrence | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const frequency = String(r['frequency'] || 'none');
    if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'monthly_nth' && frequency !== 'none') {
      return undefined;
    }
    const out: EventRecurrence = { frequency };
    const windowMonths = Number(r['windowMonths']);
    if (Number.isFinite(windowMonths) && windowMonths > 0) out.windowMonths = windowMonths;
    const until = String(r['until'] || '').trim();
    if (until) out.until = until;
    return out;
  }

  private pickUiCategory(actionTags: string[], sectorCategories: string[]): string {
    for (const t of actionTags) {
      const k = canonicalizeActionTag(String(t || '').toLowerCase());
      if (k) return k;
    }
    return 'all';
  }

  /** Parse YYYY-MM-DD as local calendar date (avoids UTC off-by-one). */
  private parseIsoDateLocal(iso: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return new Date(NaN);
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const day = Number(m[3]);
    return new Date(y, mo, day);
  }
}
