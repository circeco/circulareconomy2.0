import { ACTION_TAG_LABELS, canonicalizeActionTag } from './taxonomy';

describe('canonicalizeActionTag', () => {
  it('shows Repurpose as the visitor-facing label', () => {
    expect(ACTION_TAG_LABELS.repurpose).toBe('Repurpose');
  });

  it('maps historic misspellings to the repurpose data key', () => {
    expect(canonicalizeActionTag('reporpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('Reporpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('REPORPOUSE')).toBe('repurpose');
    expect(canonicalizeActionTag('repurpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('Repurpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('repurpose')).toBe('repurpose');
    expect(canonicalizeActionTag('Repurpose')).toBe('repurpose');
  });
});
