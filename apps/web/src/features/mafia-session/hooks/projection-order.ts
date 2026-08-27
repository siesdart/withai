function hasEventId(value: unknown): value is { eventId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'eventId' in value &&
    typeof value.eventId === 'number'
  );
}

export function retainNewerProjection(previous: unknown, incoming: unknown) {
  return hasEventId(previous) && hasEventId(incoming) && previous.eventId >= incoming.eventId
    ? previous
    : incoming;
}
