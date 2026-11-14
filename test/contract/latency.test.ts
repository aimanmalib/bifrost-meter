// Cost of the meter to the gateway: sequential quota reads through the extension's own client, as the poller makes them.
// Prints p50/p95/max so docs/TEST-RESULTS.md can quote a measured number; the bound below only catches a hung gateway.
import { describe, expect, inject, it } from 'vitest';
import { fetchQuota } from '../../src/core';

const stack = inject('contract');
const READS = 200;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

describe.skipIf(Boolean(stack.skip))('quota endpoint latency on the pinned gateway', () => {
  it(`answers ${READS} sequential quota reads with 200`, async () => {
    const key = stack.keys[0]?.value ?? '';
    const ms: number[] = [];
    for (let i = 0; i < READS; i++) {
      const t = performance.now();
      const r = await fetchQuota({ baseUrl: stack.baseUrl, key, allowInsecureHttp: true });
      ms.push(performance.now() - t);
      expect(r.kind).toBe('ok');
    }
    const sorted = [...ms].sort((a, b) => a - b);
    const fmt = (n: number) => `${n.toFixed(1)} ms`;
    console.log(`[latency] ${READS} quota GETs: p50 ${fmt(percentile(sorted, 50))}, p95 ${fmt(percentile(sorted, 95))}, max ${fmt(sorted.at(-1) ?? NaN)}`);
    expect(percentile(sorted, 95)).toBeLessThan(5000);
  }, 120_000);
});
