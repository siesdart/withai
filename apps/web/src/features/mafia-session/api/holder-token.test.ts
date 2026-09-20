import { beforeEach, describe, expect, it } from 'vitest';

import {
  addHolderTokenHeader,
  captureHolderToken,
  clearHolderToken,
  getHolderToken,
  holderTokenHeader,
  setHolderToken,
} from './holder-token';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

describe('holder token storage', () => {
  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    clearHolderToken();
  });

  it('stores only the versioned signed credential and caches reads', () => {
    setHolderToken('holder-id.signature');

    expect(getHolderToken()).toBe('holder-id.signature');
    expect(values.get('withai-holder-token:v1')).toBe(
      JSON.stringify({ version: 1, token: 'holder-id.signature' }),
    );
  });

  it('clears the credential explicitly', () => {
    setHolderToken('holder-id.signature');
    clearHolderToken();

    expect(getHolderToken()).toBeUndefined();
    expect(values.size).toBe(0);
  });

  it('adds and captures the signed credential through the request and response headers', () => {
    setHolderToken('holder-id.signature');
    const request = new Request('https://example.test');

    addHolderTokenHeader(request);
    expect(request.headers.get(holderTokenHeader)).toBe('holder-id.signature');

    captureHolderToken(
      new Response(null, { headers: { [holderTokenHeader]: 'next-holder.signature' } }),
    );
    expect(getHolderToken()).toBe('next-holder.signature');
  });
});
