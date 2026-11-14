import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Reads a recorded fixture (`test/fixtures/quota-*.json`): `{ recorded: { status }, body }`. */
export function fixture(name: string): { status: number; body: unknown } {
  const file = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  const data = JSON.parse(readFileSync(file, 'utf8')) as { recorded: { status: number }; body: unknown };
  return { status: data.recorded.status, body: data.body };
}

/** A deep copy of a fixture body as a plain object, for mutation in tests. */
export const body = (name: string): Record<string, unknown> => structuredClone(fixture(name).body) as Record<string, unknown>;
