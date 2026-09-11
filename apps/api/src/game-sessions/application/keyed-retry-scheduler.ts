import type { GameSessionClock } from './game-session-clock';

type RetryTask = () => Promise<boolean>;

export class KeyedRetryScheduler {
  private readonly entries = new Map<
    string,
    { timer: NodeJS.Timeout | undefined; generation: number }
  >();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly clock: GameSessionClock,
    private readonly initialDelayMs = 1000,
    private readonly maxDelayMs = 30_000,
  ) {}

  retry(key: string, task: RetryTask, attempt = 0) {
    if (this.entries.has(key)) return;
    const generation = this.generations.get(key) ?? 0;
    this.scheduleRetry(key, task, attempt, generation);
  }

  schedule(key: string, delayMs: number, task: () => Promise<void>) {
    if (this.entries.has(key)) return;
    const generation = this.generations.get(key) ?? 0;
    const timer = this.clock.setTimeout(() => {
      const entry = this.entries.get(key);
      if (!entry || entry.generation !== generation) return;
      entry.timer = undefined;
      void task().finally(() => this.deleteIfCurrent(key, generation));
    }, delayMs);
    this.entries.set(key, { timer, generation });
    timer.unref?.();
  }

  has(key: string) {
    return this.entries.has(key);
  }

  clear(key: string) {
    const entry = this.entries.get(key);
    if (entry?.timer) this.clock.clearTimeout(entry.timer);
    this.entries.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  clearAll() {
    for (const key of this.entries.keys()) this.clear(key);
  }

  private scheduleRetry(key: string, task: RetryTask, attempt: number, generation: number) {
    const delayMs = Math.min(this.initialDelayMs * 2 ** attempt, this.maxDelayMs);
    const timer = this.clock.setTimeout(() => {
      const entry = this.entries.get(key);
      if (!entry || entry.generation !== generation) return;
      entry.timer = undefined;
      void this.runRetry(key, task, attempt, generation);
    }, delayMs);
    this.entries.set(key, { timer, generation });
    timer.unref?.();
  }

  private async runRetry(key: string, task: RetryTask, attempt: number, generation: number) {
    let shouldRetry = false;
    try {
      shouldRetry = await task();
    } finally {
      if (shouldRetry && this.isCurrent(key, generation)) {
        this.entries.delete(key);
        this.scheduleRetry(key, task, attempt + 1, generation);
      } else {
        this.deleteIfCurrent(key, generation);
      }
    }
  }

  private isCurrent(key: string, generation: number) {
    return this.entries.get(key)?.generation === generation;
  }

  private deleteIfCurrent(key: string, generation: number) {
    if (this.isCurrent(key, generation)) this.entries.delete(key);
  }
}
