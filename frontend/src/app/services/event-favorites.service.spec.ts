import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { User } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';

import { AuthService } from './auth.service';
import { EventFavoritesService } from './event-favorites.service';
import { FS_PATHS } from '../data/firestore-paths';

function fakeUser(uid: string): User {
  return { uid } as User;
}

@Injectable()
class HarnessEventFavoritesService extends EventFavoritesService {
  saved: { uid: string; eventId: string }[] = [];
  removed: { uid: string; eventId: string }[] = [];

  protected override listen(uid: string): Observable<{ id?: string; eventId?: string }[]> {
    return snapshotFor(FS_PATHS.userEventFavourites(uid)).asObservable();
  }

  protected override writeFavorite(uid: string, eventId: string): Promise<void> {
    this.saved.push({ uid, eventId });
    return Promise.resolve();
  }

  protected override deleteFavorite(uid: string, eventId: string): Promise<void> {
    this.removed.push({ uid, eventId });
    return Promise.resolve();
  }
}

const snapshots = new Map<string, BehaviorSubject<{ id?: string; eventId?: string }[]>>();

function snapshotFor(path: string): BehaviorSubject<{ id?: string; eventId?: string }[]> {
  let subject = snapshots.get(path);
  if (!subject) {
    subject = new BehaviorSubject<{ id?: string; eventId?: string }[]>([]);
    snapshots.set(path, subject);
  }
  return subject;
}

describe('EventFavoritesService', () => {
  let user$: BehaviorSubject<User | null>;
  let service: HarnessEventFavoritesService;

  beforeEach(() => {
    snapshots.clear();
    user$ = new BehaviorSubject<User | null>(null);

    TestBed.configureTestingModule({
      providers: [
        HarnessEventFavoritesService,
        { provide: EventFavoritesService, useExisting: HarnessEventFavoritesService },
        { provide: Firestore, useValue: {} },
        { provide: AuthService, useValue: { user$ } },
      ],
    });

    service = TestBed.inject(HarnessEventFavoritesService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('scopes event favourite docs to users/{uid}/eventFavourites', () => {
    expect(FS_PATHS.userEventFavourites('user-a')).toBe('users/user-a/eventFavourites');
  });

  it('starts empty and ignores toggles while logged out', async () => {
    expect(service.isFavorite('evt-1')).toBeFalse();
    await service.toggle('evt-1');

    expect(service.saved).toEqual([]);
    expect(service.removed).toEqual([]);
    expect(service.isFavorite('evt-1')).toBeFalse();
  });

  it('loads only the signed-in user favs from their Firestore collection', () => {
    user$.next(fakeUser('user-a'));
    snapshotFor(FS_PATHS.userEventFavourites('user-a')).next([{ id: 'evt-a' }]);

    expect(service.isFavorite('evt-a')).toBeTrue();
    expect(service.isFavorite('evt-b')).toBeFalse();
  });

  it('does not leak user A favs to user B or a logged-out session', () => {
    user$.next(fakeUser('user-a'));
    snapshotFor(FS_PATHS.userEventFavourites('user-a')).next([{ id: 'evt-a' }]);
    expect(service.isFavorite('evt-a')).toBeTrue();

    user$.next(fakeUser('user-b'));
    expect(service.isFavorite('evt-a')).toBeFalse();
    snapshotFor(FS_PATHS.userEventFavourites('user-b')).next([{ id: 'evt-b' }]);
    expect(service.isFavorite('evt-b')).toBeTrue();
    expect(service.isFavorite('evt-a')).toBeFalse();

    user$.next(null);
    expect(service.favoriteIds().size).toBe(0);
    expect(service.isFavorite('evt-b')).toBeFalse();
  });

  it('restores a user favs after they log back in', () => {
    user$.next(fakeUser('user-a'));
    snapshotFor(FS_PATHS.userEventFavourites('user-a')).next([{ id: 'evt-a' }]);
    user$.next(null);
    expect(service.isFavorite('evt-a')).toBeFalse();

    user$.next(fakeUser('user-a'));
    snapshotFor(FS_PATHS.userEventFavourites('user-a')).next([{ id: 'evt-a' }]);
    expect(service.isFavorite('evt-a')).toBeTrue();
  });

  it('writes toggles to the signed-in user eventFavourites docs', async () => {
    user$.next(fakeUser('user-a'));

    await service.toggle('evt-1');
    expect(service.isFavorite('evt-1')).toBeTrue();
    expect(service.saved).toEqual([{ uid: 'user-a', eventId: 'evt-1' }]);

    await service.toggle('evt-1');
    expect(service.isFavorite('evt-1')).toBeFalse();
    expect(service.removed).toEqual([{ uid: 'user-a', eventId: 'evt-1' }]);
  });

  it('clears the legacy shared localStorage key', () => {
    localStorage.setItem('circeco_event_favorites', JSON.stringify(['evt-old']));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        HarnessEventFavoritesService,
        { provide: Firestore, useValue: {} },
        { provide: AuthService, useValue: { user$: new BehaviorSubject<User | null>(null) } },
      ],
    });
    TestBed.inject(HarnessEventFavoritesService);
    expect(localStorage.getItem('circeco_event_favorites')).toBeNull();
  });
});
