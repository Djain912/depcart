import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registryFor } from '../registries';
import type { PackageSummary, Registry } from '../registries/types';
import { firstNonEmpty, verifySuggestions, withDeadline, type Source } from '../search';

const fast = { stepMs: 300, hedgeMs: 50 };
const hit = (name: string): PackageSummary[] => [{ registry: 'npm', name, version: '1.0.0', description: '' }];
const after = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const never: Source = () => new Promise(() => undefined);
const failing: Source = async () => {
  throw new Error('registry down');
};

test('a quick answer from the first source wins without starting the second', async () => {
  let secondStarted = false;
  const results = await firstNonEmpty(
    [
      async () => hit('first'),
      async () => {
        secondStarted = true;
        return hit('second');
      },
    ],
    new AbortController().signal,
    fast,
  );
  assert.deepEqual(results.map((r) => r.name), ['first']);
  assert.equal(secondStarted, false);
});

test('falls back when the first source is empty or fails', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual((await firstNonEmpty([async () => [], async () => hit('backup')], signal, fast)).map((r) => r.name), ['backup']);
  assert.deepEqual((await firstNonEmpty([failing, async () => hit('backup')], signal, fast)).map((r) => r.name), ['backup']);
});

test('a hanging source is overtaken by the backup and never blocks', async () => {
  // A long step deadline, so finishing well under it proves nothing waited for the hanging source,
  // with room to spare on a busy CI machine.
  const started = Date.now();
  const results = await firstNonEmpty([never, () => after(20, hit('backup'))], new AbortController().signal, { stepMs: 2000, hedgeMs: 50 });
  assert.deepEqual(results.map((r) => r.name), ['backup']);
  assert.ok(Date.now() - started < 1000);
});

test('a slow first source still counts if it answers before the backup', async () => {
  const results = await firstNonEmpty([() => after(80, hit('slow-first')), () => after(200, hit('backup'))], new AbortController().signal, fast);
  assert.deepEqual(results.map((r) => r.name), ['slow-first']);
});

test('empty when nothing matches; throws only when every source failed', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await firstNonEmpty([async () => [], failing], signal, fast), []);
  await assert.rejects(firstNonEmpty([failing, failing], signal, fast), /registry down/);
  await assert.rejects(firstNonEmpty([never, never], signal, fast), /no answer within/);
});

test('withDeadline settles even when the work ignores its abort signal', async () => {
  await assert.rejects(withDeadline(() => new Promise(() => undefined), new AbortController().signal, 30), /no answer within/);
});

test('AI suggestions are kept only when they exist on the registry', async () => {
  const npm = registryFor('npm')!;
  const fakeNpm: Registry = {
    ...npm,
    versions: async (name) => {
      if (name !== 'zod') {
        throw new Error('404');
      }
      return { versions: ['4.6.5', '4.6.4'], prereleases: [], latest: '4.6.5' };
    },
  };
  const results = await verifySuggestions([fakeNpm], { npm: ['zod', 'zod-made-up-by-ai'] }, new AbortController().signal, 300);
  assert.deepEqual(
    results.map((r) => [r.name, r.version, r.via]),
    [['zod', '4.6.5', 'ai']],
  );
});
