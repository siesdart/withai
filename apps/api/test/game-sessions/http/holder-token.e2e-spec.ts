import { describe, expect, it } from 'vitest';

import { createHolderTokenSigner } from '../../../src/game-sessions/transport/holder-token.js';

describe('holder token signer', () => {
  it('round-trips a signed holder id and rejects tampering', () => {
    const signer = createHolderTokenSigner('test-secret');
    const holderId = signer.createHolderId();
    const token = signer.sign(holderId);

    expect(signer.read(token)).toBe(holderId);
    expect(signer.read(`${token}tampered`)).toBeUndefined();
    expect(signer.read(undefined)).toBeUndefined();
  });
});
