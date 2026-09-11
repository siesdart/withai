import { describe, expect, it } from 'vitest';

import { hasReachedScrollEnd } from './use-public-discussion-scroll';

describe('hasReachedScrollEnd', () => {
  it('recognizes an intentional scroll to the latest message', () => {
    expect(
      hasReachedScrollEnd({
        clientHeight: 300,
        scrollHeight: 1_200,
        scrollTop: 900,
      }),
    ).toBe(true);
  });

  it('does not resume auto-scroll while messages remain below the viewport', () => {
    expect(
      hasReachedScrollEnd({
        clientHeight: 300,
        scrollHeight: 1_200,
        scrollTop: 898,
      }),
    ).toBe(false);
  });
});
