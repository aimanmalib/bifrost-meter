// Refresh scheduling: a fixed interval, exponential back-off after errors (at most 5 minutes) and a slower pace while the
// window is not focused. Timers are injected so tests drive it with a fake clock.

export const MAX_DELAY_MS = 5 * 60_000;
export const UNFOCUSED_FACTOR = 4;

export function nextDelayMs(intervalSeconds: number, failures: number, focused: boolean): number {
  const base = intervalSeconds * 1_000;
  const ceiling = Math.max(base, MAX_DELAY_MS);
  let delay = failures > 0 ? Math.min(base * 2 ** failures, ceiling) : base;
  if (!focused) delay = Math.min(delay * UNFOCUSED_FACTOR, ceiling);
  return delay;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Poller {
  private handle: unknown;
  private failures = 0;
  private focused = true;
  private running = false;
  private again = false;
  private stopped = true;

  /** `tick` returns true on success; `intervalSeconds` is read on every scheduling so setting changes apply. */
  constructor(
    private readonly tick: () => Promise<boolean>,
    private readonly intervalSeconds: () => number,
    private readonly timers: Timers = realTimers,
  ) {}

  start(): void {
    this.stopped = false;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.cancel();
  }

  /** Refresh now (command, settings change, key change); resets the back-off. */
  refreshNow(): Promise<void> {
    this.failures = 0;
    return this.run();
  }

  setFocused(focused: boolean): void {
    const regained = focused && !this.focused;
    this.focused = focused;
    // Coming back to the window refreshes at once, so the numbers are fresh when someone looks.
    if (regained && !this.stopped) void this.run();
  }

  get failureCount(): number {
    return this.failures;
  }

  private cancel(): void {
    if (this.handle !== undefined) this.timers.clear(this.handle);
    this.handle = undefined;
  }

  private async run(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.cancel();
    this.running = true;
    try {
      const ok = await this.tick().catch(() => false);
      this.failures = ok ? 0 : this.failures + 1;
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      return this.run();
    }
    if (!this.stopped) {
      this.handle = this.timers.set(() => void this.run(), nextDelayMs(this.intervalSeconds(), this.failures, this.focused));
    }
  }
}
