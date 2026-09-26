import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registryFor } from '../registries';
import { ecosystemsSearch } from '../registries/ecosystems';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serves canned ecosyste.ms responses and records every request made. */
function fakeIndex(names: Record<string, string[]>, details: { name: string; latest_release_number: string; description: string }[]) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}?${url.searchParams}`);
    const key = url.searchParams.has('postfix') ? `postfix=${url.searchParams.get('postfix')}` : `prefix=${url.searchParams.get('prefix')}`;
    const body = url.pathname.endsWith('/bulk_lookup') ? details : names[key] ?? [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return requests;
}

test('Go matches on the last path segment first, then prefix, ranked by dependents, with details', async () => {
  const requests = fakeIndex(
    { 'postfix=/gin': ['github.com/gin-gonic/gin', 'github.com/codegangsta/gin'], 'prefix=gin': ['gin.example/x', 'github.com/gin-gonic/gin'] },
    [{ name: 'github.com/gin-gonic/gin', latest_release_number: 'v1.12.0', description: 'HTTP web framework' }],
  );
  const results = await ecosystemsSearch(registryFor('go')!, ' Gin ', 10, new AbortController().signal);
  assert.deepEqual(
    results.map((r) => [r.name, r.version, r.description, r.via]),
    [
      ['github.com/gin-gonic/gin', 'v1.12.0', 'HTTP web framework', 'ecosyste.ms'],
      ['github.com/codegangsta/gin', '', '', 'ecosyste.ms'],
      ['gin.example/x', '', '', 'ecosyste.ms'],
    ],
  );
  assert.ok(requests.some((r) => r.includes('/registries/proxy.golang.org/package_names') && r.includes('sort=dependent_packages_count')));
  assert.ok(requests.some((r) => r.startsWith('POST /api/v1/packages/bulk_lookup')));
});

test('Maven hides the index version (it is stale) and joins words with dashes', async () => {
  const requests = fakeIndex({ 'postfix=:jackson-databind': ['com.fasterxml.jackson.core:jackson-databind'] }, [
    { name: 'com.fasterxml.jackson.core:jackson-databind', latest_release_number: '2.0.0', description: 'data binding' },
  ]);
  const results = await ecosystemsSearch(registryFor('maven')!, 'jackson databind', 10, new AbortController().signal);
  assert.deepEqual(results.map((r) => [r.name, r.version, r.description]), [['com.fasterxml.jackson.core:jackson-databind', '', 'data binding']]);
  assert.ok(requests.some((r) => r.includes('postfix=%3Ajackson-databind')));
});

test('no matches means no bulk lookup', async () => {
  const requests = fakeIndex({}, []);
  assert.deepEqual(await ecosystemsSearch(registryFor('npm')!, 'zzzz', 10, new AbortController().signal), []);
  assert.ok(!requests.some((r) => r.includes('bulk_lookup')));
});
