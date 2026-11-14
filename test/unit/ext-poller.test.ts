import { describe, expect, it } from 'vitest';
import { MAX_DELAY_MS, nextDelayMs, Poller, type Timers } from '../../src/extension/poller';

describe('nextDelayMs', () => {
  it.each([
    [60, 0, true, 60_000],
    [60, 1, true, 120_000],
    [60, 2, true, 240_000],
    [60, 3, true, MAX_DELAY_MS],
    [60, 10, true, MAX_DELAY_MS],
    [60, 0, false, 240_000],
    [60, 1, false, MAX_DELAY_MS],
    [15, 0, true, 15_000],
    [600, 0, true, 600_000],
    [600, 3, false, 600_000],
  ])('interval %ds, %d failures, focused %s → %d ms', (s, f, focused, want) => expect(nextDelayMs(s, f, focused)).toBe(want));
});

/** A fake clock: timers fire only when the test advances time. */
class FakeTimers implements Timers {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  }
  clear(h: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== h);
  }
  get pending(): number[] {
    return this.queue.map((q) => q.at - this.now);
  }
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = this.queue.filter((q) => q.at <= this.now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.clear(due.id);
      due.fn();
      await flush();
    }
  }
}
const flush = () => new Promise((r) => setImmediate(r));

function setup(results: boolean[]) {
  const timers = new FakeTimers();
  let calls = 0;
  const poller = new Poller(async () => results[calls++] ?? true, () => 60, timers);
  return { timers, poller, calls: () => calls };
}

describe('Poller', () => {
  it('polls on the interval', async () => {
    const { timers, poller, calls } = setup([]);
    poller.start();
    await flush();
    expect(calls()).toBe(1);
    expect(timers.pending).toEqual([60_000]);
    await timers.advance(60_000);
    expect(calls()).toBe(2);
  });
  it('backs off after errors and recovers after a success', async () => {
    const { timers, poller } = setup([false, false, true]);
    poller.start();
    await flush();
    expect(timers.pending).toEqual([120_000]);
    await timers.advance(120_000);
    expect(timers.pending).toEqual([240_000]);
    await timers.advance(240_000);
    expect(timers.pending).toEqual([60_000]);
    expect(poller.failureCount).toBe(0);
  });
  it('slows down when the window loses focus and refreshes when it comes back', async () => {
    const { timers, poller, calls } = setup([]);
    poller.start();
    await flush();
    poller.setFocused(false);
    await timers.advance(60_000);
    expect(timers.pending).toEqual([240_000]);
    poller.setFocused(true);
    await flush();
    expect(calls()).toBe(3);
    expect(timers.pending).toEqual([60_000]);
  });
  it('refreshNow resets the back-off and keeps one timer', async () => {
    const { timers, poller } = setup([false, false, true]);
    poller.start();
    await flush();
    await poller.refreshNow();
    expect(timers.pending).toHaveLength(1);
  });
  it('never runs two refreshes at once', async () => {
    let active = 0;
    let max = 0;
    const timers = new FakeTimers();
    const poller = new Poller(async () => {
      active++;
      max = Math.max(max, active);
      await flush();
      active--;
      return true;
    }, () => 60, timers);
    poller.start();
    void poller.refreshNow();
    void poller.refreshNow();
    await flush();
    await flush();
    await flush();
    expect(max).toBe(1);
    expect(timers.pending).toHaveLength(1);
  });
  it('stop cancels the timer', async () => {
    const { timers, poller, calls } = setup([]);
    poller.start();
    await flush();
    poller.stop();
    expect(timers.pending).toEqual([]);
    await timers.advance(600_000);
    expect(calls()).toBe(1);
  });
  it('a throwing tick counts as a failure', async () => {
    const timers = new FakeTimers();
    const poller = new Poller(() => Promise.reject(new Error('boom')), () => 60, timers);
    poller.start();
    await flush();
    expect(poller.failureCount).toBe(1);
    expect(timers.pending).toEqual([120_000]);
  });
});
