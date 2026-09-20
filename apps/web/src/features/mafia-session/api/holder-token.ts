import * as v from 'valibot';

export const holderTokenHeader = 'X-Holder-Token';

const holderTokenStorageKey = 'withai-holder-token:v1';
const StoredHolderTokenSchema = v.object({
  version: v.literal(1),
  token: v.pipe(v.string(), v.minLength(1)),
});

let cachedToken: string | undefined;
let cacheInitialized = false;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === holderTokenStorageKey) {
      cacheInitialized = false;
      cachedToken = undefined;
    }
  });
}

export function getHolderToken(): string | undefined {
  if (cacheInitialized) return cachedToken;
  cacheInitialized = true;

  try {
    const raw = window.localStorage.getItem(holderTokenStorageKey);
    if (!raw) return undefined;
    const parsed = v.safeParse(StoredHolderTokenSchema, JSON.parse(raw));
    cachedToken = parsed.success ? parsed.output.token : undefined;
  } catch {
    cachedToken = undefined;
  }

  return cachedToken;
}

export function setHolderToken(token: string): void {
  cachedToken = token;
  cacheInitialized = true;

  try {
    window.localStorage.setItem(holderTokenStorageKey, JSON.stringify({ version: 1, token }));
  } catch {
    // The in-memory cache keeps the current tab usable when storage is unavailable.
  }
}

export function clearHolderToken(): void {
  cachedToken = undefined;
  cacheInitialized = true;

  try {
    window.localStorage.removeItem(holderTokenStorageKey);
  } catch {
    // Storage can be unavailable in private browsing or restricted test contexts.
  }
}

export function addHolderTokenHeader(request: Request): void {
  const token = getHolderToken();
  if (token) request.headers.set(holderTokenHeader, token);
}

export function captureHolderToken(response: Response): void {
  const token = response.headers.get(holderTokenHeader);
  if (token) setHolderToken(token);
}
