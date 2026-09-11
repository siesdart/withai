export type IdempotencyRecord<Result> = {
  fingerprint: string;
  result: Result;
};

export type IdempotencyLookup<Result> =
  | { type: 'new-request' }
  | { type: 'replayed'; result: Result }
  | { type: 'conflict' };

export function lookupIdempotency<Result>(
  records: ReadonlyMap<string, IdempotencyRecord<Result>>,
  key: string,
  fingerprint: string,
): IdempotencyLookup<Result> {
  const previous = records.get(key);
  if (!previous) {
    return { type: 'new-request' };
  }

  return previous.fingerprint === fingerprint
    ? { type: 'replayed', result: previous.result }
    : { type: 'conflict' };
}

export function recordIdempotency<Result>(
  records: Map<string, IdempotencyRecord<Result>>,
  key: string,
  fingerprint: string,
  result: Result,
) {
  records.set(key, { fingerprint, result });
}
