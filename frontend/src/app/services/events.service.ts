import { inject, Injectable } from '@angular/core';
import { Firestore, collection, query, where, limit } from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FS_PATHS } from '../data/firestore-paths';
import { CityContextService } from './city-context.service';

export interface EventItem {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  time: string;
  image: string;
  date: Date;
  dateStr: string;
}

export const EVENT_CATEGORIES = [
  { id: 'all', label: 'All', icon: '●' },
  { id: 'repair', label: 'Repair', icon: '🔧' },
  { id: 'recycle', label: 'Recycle', icon: '♻' },
  { id: 'share', label: 'Share', icon: '↗' },
  { id: 'reuse', label: 'Reuse', icon: '📦' },
] as const;

const DEFAULT_EVENT_IMAGE =
  'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=400&h=300&fit=crop';

const UI_CATEGORY_SLUGS = EVENT_CATEGORIES.map((c) => c.id).filter((id) => id !== 'all') as string[];

@Injectable({ providedIn: 'root' })
export class EventsService {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);

  private readonly staticEvents: EventItem[] = [
    {
      id: '1',
      title: 'Clothing Swap',
      description:
        'Swap your gently used clothes and find new-to-you items. Bring clothes to trade and leave with a refreshed wardrobe.',
      category: 'share',
      location: 'Norrtullsgatan 31, Stockholm',
      time: 'Sat 10AM-2PM',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop',
      date: new Date(2025, 11, 20),
      dateStr: 'December 20th, 2025',
    },
    {
      id: '2',
      title: 'Repair Workshop',
      description:
        "Learn to fix electronics, furniture, and household items with expert volunteers. Bring your broken items and we'll help you repair them.",
      category: 'repair',
      location: 'Hagagatan 3, Stockholm',
      time: 'Sun 1PM-5PM',
      image: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 17),
      dateStr: 'February 17th, 2026',
    },
    {
      id: '3',
      title: 'Garden Day',
      description:
        'Grow food together and learn about sustainable agriculture. Join us for planting, harvesting, and workshops.',
      category: 'share',
      location: 'Nybrogatan 44, Stockholm',
      time: 'Wed 9AM-12PM',
      image: 'https://images.unsplash.com/photo-1592150621744-aca64f48394a?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 18),
      dateStr: 'February 18th, 2026',
    },
    {
      id: '4',
      title: 'Recycling Workshop',
      description:
        'Educational center for proper recycling and waste reduction. Learn what can be recycled and how to reduce your waste footprint.',
      category: 'recycle',
      location: 'Norrtullsgatan 9, Stockholm',
      time: 'Tue 2PM-4PM',
      image: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=400&h=300&fit=crop',
      date: new Date(2026, 1, 25),
      dateStr: 'February 25th, 2026',
    },
    {
      id: '5',
      title: 'Tool Library Open Day',
      description:
        'Borrow tools and equipment for your DIY projects. Membership is free for the community.',
      category: 'reuse',
      location: 'Handenterminalen 5, Stockholm',
      time: 'Sat 9AM-3PM',
      image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=400&h=300&fit=crop',
      date: new Date(2026, 2, 1),
      dateStr: 'March 1st, 2026',
    },
  ];

  /**
   * Static demo events merged with approved `events` from Firestore (live updates).
   * Query must include `where('status','==','approved')` so Firestore rules can allow
   * only approved docs (queries must not be able to return documents the user cannot read).
   */
  readonly events$: Observable<EventItem[]> = this.cityContext.cityId$.pipe(
    switchMap((cityId) =>
      collectionData(
        query(
          collection(this.fs, FS_PATHS.events),
          where('status', '==', 'approved'),
          where('cityId', '==', cityId),
          limit(100)
        ),
        { idField: 'id' }
      ).pipe(
        map((docs: Record<string, unknown>[]) => {
          const approved = docs
            .map((d) => this.firestoreDocToEventItem(d))
            .filter((e): e is EventItem => !!e);
          const staticForCity = cityId === 'stockholm' ? this.staticEvents : [];
          return this.mergeAndSort(staticForCity, approved);
        }),
        catchError((err) => {
          console.warn('[events] Firestore read failed; using city fallback', err);
          return of(cityId === 'stockholm' ? [...this.staticEvents] : []);
        })
      )
    )
  );

  /** @deprecated Prefer `events$` for Firestore-backed list */
  getEvents(): EventItem[] {
    return [...this.staticEvents];
  }

  getEventById(id: string): EventItem | undefined {
    return this.staticEvents.find((e) => e.id === id);
  }

  private mergeAndSort(staticE: EventItem[], remote: EventItem[]): EventItem[] {
    return [...staticE, ...remote].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private firestoreDocToEventItem(d: Record<string, unknown>): EventItem | null {
    const id = String(d['id'] ?? '');
    const title = String(d['title'] ?? '');
    const startDate = d['startDate'];
    if (!id || !title || typeof startDate !== 'string') return null;

    const date = this.parseIsoDateLocal(startDate);
    if (isNaN(date.getTime())) return null;

    const tags = Array.isArray(d['actionTags']) ? (d['actionTags'] as string[]) : [];
    const sectors = Array.isArray(d['sectorCategories']) ? (d['sectorCategories'] as string[]) : [];
    const category = this.pickUiCategory(tags, sectors);

    return {
      id,
      title,
      description: String(d['description'] ?? ''),
      category,
      location: String(d['address'] || d['locationText'] || ''),
      time: String(d['timeDisplay'] ?? ''),
      image: typeof d['imageUrl'] === 'string' && d['imageUrl'] ? String(d['imageUrl']) : DEFAULT_EVENT_IMAGE,
      date,
      dateStr: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    };
  }

  private pickUiCategory(actionTags: string[], sectorCategories: string[]): string {
    for (const t of actionTags) {
      const k = String(t).toLowerCase();
      if (UI_CATEGORY_SLUGS.includes(k)) return k;
    }
    for (const s of sectorCategories) {
      const k = String(s).toLowerCase();
      if (UI_CATEGORY_SLUGS.includes(k)) return k;
    }
    return 'share';
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
