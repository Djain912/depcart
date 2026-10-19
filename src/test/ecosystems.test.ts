import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { registryFor } from '../registries';
import { ecosystemsHealth, ecosystemsSearch, healthOf, matchRecords, type LookupResult } from '../registries/ecosystems';

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

/** Serves canned bulk_lookup records and records the names asked for. */
function fakeLookup(records: LookupResult[]) {
  const asked: string[][] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    asked.push(JSON.parse(String(init?.body)).names);
    return new Response(JSON.stringify(records), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return asked;
}

const ZOD: LookupResult = {
  name: 'zod',
  downloads: 1431684297,
  downloads_period: 'last-month',
  dependent_packages_count: 6111,
  latest_release_number: '4.6.7',
  latest_release_published_at: '2026-10-12T16:29:37.778Z',
  repository_url: 'https://github.com/colinhacks/zod',
  repo_metadata: { pushed_at: '2026-10-11T16:19:02.000Z', archived: false, stargazers_count: 44090 },
  status: null,
};

test('health: monthly downloads, latest release, last push and stars from one index record', () => {
  assert.deepEqual(healthOf(registryFor('npm')!, ZOD), {
    downloads: 1431684297,
    downloadsPeriod: 'month',
    dependents: 6111,
    released: '2026-10-12T16:29:37.778Z',
    releasedVersion: '4.6.7',
    committed: '2026-10-11T16:19:02.000Z',
    stars: 44090,
    repository: 'github.com/colinhacks/zod',
  });
});

test('health: all-time downloads, deprecated and archived packages, odd repository URLs', () => {
  const health = healthOf(registryFor('crates')!, {
    name: 'failure',
    downloads: 1549007445,
    downloads_period: 'total',
    status: 'deprecated',
    repository_url: 'git+ssh://git@github.com/rust-lang-nursery/failure.git',
    repo_metadata: { pushed_at: '2020-05-02T00:00:00Z', archived: true },
  });
  assert.equal(health?.downloadsPeriod, 'total');
  assert.equal(health?.deprecated, true);
  assert.equal(health?.archived, true);
  assert.equal(health?.repository, undefined, 'only plain web URLs are shown');
  const trailing = healthOf(registryFor('npm')!, { ...ZOD, repository_url: 'https://github.com/colinhacks/zod.git/' });
  assert.equal(trailing?.repository, 'github.com/colinhacks/zod');
});

test('health: Maven hides the index release date (it is years stale); bad values are dropped', () => {
  const guava = healthOf(registryFor('maven')!, {
    name: 'com.google.guava:guava',
    downloads: null,
    latest_release_number: '23.0',
    latest_release_published_at: '2017-08-04T21:24:32.000Z',
    dependent_packages_count: 29526,
    repo_metadata: { pushed_at: '2026-10-16T21:08:56.000Z' },
  });
  assert.equal(guava?.released, undefined);
  assert.equal(guava?.dependents, 29526);
  assert.equal(guava?.committed, '2026-10-16T21:08:56.000Z');
  assert.equal(healthOf(registryFor('npm')!, { name: 'x', downloads: 5, downloads_period: 'last-week' }), undefined);
  // Seen live: a Go module with no release number but "published today", and a sub-package with 0 dependents.
  const autorest = { name: 'github.com/Azure/go-autorest/autorest', latest_release_number: null, latest_release_published_at: '2026-10-18T00:00:00Z' };
  assert.equal(healthOf(registryFor('go')!, autorest), undefined);
  assert.equal(healthOf(registryFor('go')!, { name: 'github.com/go-kit/kit/transport/http', dependent_packages_count: 0 }), undefined);
  const junk = { name: 'x', latest_release_published_at: 'not a date', downloads: -1, downloads_period: 'total' };
  assert.equal(healthOf(registryFor('npm')!, junk), undefined);
});

test('names match exactly first, loosely only when unambiguous (npm has JSONStream and jsonstream)', () => {
  const records = [{ name: 'jsonstream' }, { name: 'JSONStream' }, { name: 'zod' }];
  const matched = matchRecords(registryFor('npm')!, ['JSONStream', 'jsonstream', 'Zod', 'JsonStream'], records);
  assert.equal(matched.get('JSONStream')?.name, 'JSONStream');
  assert.equal(matched.get('jsonstream')?.name, 'jsonstream');
  assert.equal(matched.get('Zod')?.name, 'zod');
  assert.equal(matched.has('JsonStream'), false, 'two candidates: no guess');
});

test('repeated records keep the first (the index can list a gem twice)', () => {
  const records = [
    { name: 'rails', n: 1 },
    { name: 'rails', n: 2 },
  ];
  assert.equal(matchRecords(registryFor('rubygems')!, ['rails'], records).get('rails')?.n, 1);
});

test('PyPI and NuGet names are looked up in the spelling the index uses', async () => {
  const asked = fakeLookup([
    { ...ZOD, name: 'flask' },
    { ...ZOD, name: 'typing-extensions' },
  ]);
  const health = await ecosystemsHealth(registryFor('pypi')!, ['Flask', 'typing_extensions', 'not-there'], new AbortController().signal);
  assert.deepEqual(asked, [['Flask', 'flask', 'typing_extensions', 'typing-extensions', 'not-there']]);
  assert.equal(health.Flask?.downloads, 1431684297);
  assert.equal(health.typing_extensions?.downloads, 1431684297);
  assert.equal(health['not-there'], null);

  const nugetAsked = fakeLookup([{ ...ZOD, name: 'newtonsoft.json' }]);
  const nuget = await ecosystemsHealth(registryFor('nuget')!, ['Newtonsoft.Json'], new AbortController().signal);
  assert.deepEqual(nugetAsked, [['Newtonsoft.Json', 'newtonsoft.json']]);
  assert.equal(nuget['Newtonsoft.Json']?.stars, 44090);
});

test('large lookups are split into batches', async () => {
  const asked = fakeLookup([]);
  const names = Array.from({ length: 30 }, (_, i) => `pkg${i}`);
  const health = await ecosystemsHealth(registryFor('npm')!, names, new AbortController().signal);
  assert.deepEqual(
    asked.map((a) => a.length),
    [25, 5],
  );
  assert.equal(Object.keys(health).length, 30);
});

test('index search results carry health from the same lookup', async () => {
  fakeIndex({ 'prefix=zod': ['zod'] }, [ZOD as never]);
  const [zod] = await ecosystemsSearch(registryFor('npm')!, 'zod', 10, new AbortController().signal);
  assert.equal(zod.health?.downloads, 1431684297);
  assert.equal(zod.health?.committed, '2026-10-11T16:19:02.000Z');
});
