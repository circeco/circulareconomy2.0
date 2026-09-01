import { holdUserUntilSignOut } from './auth.service';
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
});
