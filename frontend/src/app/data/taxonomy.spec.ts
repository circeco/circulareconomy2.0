import { ACTION_TAG_LABELS, canonicalizeActionTag } from './taxonomy';

describe('canonicalizeActionTag', () => {
  it('keeps Repurpose as the visitor-facing label', () => {
    expect(ACTION_TAG_LABELS.repurpose).toBe('Repurpose');
  });

  it('maps historic reporpouse data to the repurpose key', () => {
    expect(canonicalizeActionTag('reporpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('Reporpouse')).toBe('repurpose');
    expect(canonicalizeActionTag('repurpose')).toBe('repurpose');
  });
});
