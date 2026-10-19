import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthLookup } from '../health';
import { registryFor } from '../registries';
import type { PackageHealth } from '../registries/types';

const npm = registryFor('npm')!;
const signal = new AbortController().signal;

function counting(answer: (name: string) => PackageHealth | null) {
  const calls: string[][] = [];
  const fetchHealth = async (_registry: unknown, names: string[]) => {
    calls.push(names);
    return Object.fromEntries(names.map((n) => [n, answer(n)]));
  };
  return { calls, fetchHealth };
}

test('answers are remembered: refining a search does not look the same packages up again', async () => {
  const zod: PackageHealth = { downloads: 1, downloadsPeriod: 'month' };
  const { calls, fetchHealth } = counting((n) => (n === 'zod' ? zod : null));
  const lookup = new HealthLookup(fetchHealth);
  // Answers have no prototype, so compare plain copies.
  assert.deepEqual({ ...(await lookup.get(npm, ['zod', 'nothing'], signal)) }, { zod, nothing: null });
  assert.deepEqual({ ...(await lookup.get(npm, ['zod', 'nothing', 'zod-to-json-schema'], signal)) }, { zod, nothing: null, 'zod-to-json-schema': null });
  assert.deepEqual(calls, [['zod', 'nothing'], ['zod-to-json-schema']]);
});

test('answers expire after half an hour; failures are not remembered', async () => {
  let now = 0;
  let fail = true;
  const calls: string[][] = [];
  const lookup = new HealthLookup(
    async (_registry, names) => {
      calls.push(names);
      if (fail) {
        throw new Error('offline');
      }
      return {};
    },
    () => now,
  );
  await assert.rejects(lookup.get(npm, ['zod'], signal));
  fail = false;
  await lookup.get(npm, ['zod'], signal);
  now += 29 * 60 * 1000;
  await lookup.get(npm, ['zod'], signal);
  now += 2 * 60 * 1000;
  await lookup.get(npm, ['zod'], signal);
  assert.equal(calls.length, 3);
});

test('the same name on two registries is two packages', async () => {
  const { calls, fetchHealth } = counting(() => null);
  const lookup = new HealthLookup(fetchHealth);
  await lookup.get(npm, ['http'], signal);
  await lookup.get(registryFor('pub')!, ['http'], signal);
  assert.equal(calls.length, 2);
});

test('a package named __proto__ is answered like any other', async () => {
  // Object.fromEntries makes "__proto__" an own key, as ecosystemsHealth does.
  const lookup = new HealthLookup(async () => Object.fromEntries([['__proto__', { stars: 1 }]]));
  const result = await lookup.get(registryFor('pub')!, ['__proto__'], signal);
  assert.deepEqual(Object.keys(result), ['__proto__']);
});
