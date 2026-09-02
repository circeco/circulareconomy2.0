import {
  holdUserUntilSignOut,
  readPersistedDisplayUser,
  toDisplayUserSnapshot,
  writePersistedDisplayUser,
  DISPLAY_USER_LS_KEY,
} from './auth.service';
import type { User } from '@angular/fire/auth';

describe('holdUserUntilSignOut', () => {
  const user = { uid: 'u1', email: 'a@b.c', photoURL: null } as User;

  it('keeps the last user when the stream emits null without sign-out', () => {
    expect(holdUserUntilSignOut(user, null, false)).toBe(user);
  });

  it('clears the user after an intentional sign-out', () => {
    expect(holdUserUntilSignOut(user, null, true)).toBeNull();
  });

  it('replaces the displayed user when a user is emitted', () => {
    const next = { uid: 'u2', email: 'c@d.e', photoURL: null } as User;
    expect(holdUserUntilSignOut(user, next, false)).toBe(next);
  });

  it('keeps a persisted avatar through auth hydration, navigation, and city-list nulls', () => {
    const persisted = { uid: 'u1', email: 'a@b.c', photoURL: 'https://img/a.png' };
    expect(holdUserUntilSignOut(persisted, null, false)).toBe(persisted);
    const live = { uid: 'u1', email: 'a@b.c', photoURL: 'https://img/a.png' };
    expect(holdUserUntilSignOut(persisted, live, false)).toBe(live);
  });
});

describe('display user persistence', () => {
  beforeEach(() => {
    try { localStorage.removeItem(DISPLAY_USER_LS_KEY); } catch {}
  });

  afterEach(() => {
    try { localStorage.removeItem(DISPLAY_USER_LS_KEY); } catch {}
  });

  it('round-trips a snapshot so reload can show the last avatar', () => {
    writePersistedDisplayUser({ uid: 'u1', email: 'a@b.c', photoURL: 'https://img/a.png' });
    expect(readPersistedDisplayUser()).toEqual({
      uid: 'u1',
      email: 'a@b.c',
      photoURL: 'https://img/a.png',
    });
  });

  it('clears the snapshot on sign-out', () => {
    writePersistedDisplayUser({ uid: 'u1', email: 'a@b.c', photoURL: null });
    writePersistedDisplayUser(null);
    expect(readPersistedDisplayUser()).toBeNull();
  });

  it('returns null when nothing has been persisted', () => {
    expect(readPersistedDisplayUser()).toBeNull();
  });

  it('snapshots uid, email, and photoURL from a live user', () => {
    expect(toDisplayUserSnapshot({
      uid: 'u1',
      email: 'a@b.c',
      photoURL: 'https://img/a.png',
    })).toEqual({
      uid: 'u1',
      email: 'a@b.c',
      photoURL: 'https://img/a.png',
    });
  });
});
