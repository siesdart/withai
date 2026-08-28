export type IdempotentDraft<Value extends object> = Value & {
  idempotencyKey: string;
};

export function nextIdempotentDraft<Value extends object>(
  value: Value,
  existing: IdempotentDraft<Value> | undefined,
  isSame: (value: Value, existing: IdempotentDraft<Value>) => boolean,
): IdempotentDraft<Value> {
  if (existing && isSame(value, existing)) {
    return existing;
  }

  return { ...value, idempotencyKey: crypto.randomUUID() };
}

export function clearIdempotentDraft<Value extends object>(
  draft: IdempotentDraft<Value> | undefined,
  idempotencyKey: string,
) {
  return draft?.idempotencyKey === idempotencyKey ? undefined : draft;
}
