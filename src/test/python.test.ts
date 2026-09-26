import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePep440, isPep440Prerelease } from '../pep440';
import { createNameIndex, rankNames } from '../registries/pypi';

test('PEP 440 ordering: dev < alpha < beta < rc < final < post', () => {
  const versions = ['1.0', '1.0.post1', '1.0rc1', '1.0a1', '1.0b2', '1.0.dev1', '2.0', '1.10', '1.9.1', '1.0a1.dev1'];
  assert.deepEqual(
    versions.sort((a, b) => comparePep440(b, a)),
    ['2.0', '1.10', '1.9.1', '1.0.post1', '1.0', '1.0rc1', '1.0b2', '1.0a1', '1.0a1.dev1', '1.0.dev1'],
  );
  assert.equal(comparePep440('1.0', '1.0.0'), 0);
});

test('PEP 440 pre-release detection', () => {
  assert.equal(isPep440Prerelease('1.0rc1'), true);
  assert.equal(isPep440Prerelease('2.0.0.dev3'), true);
  assert.equal(isPep440Prerelease('1.0.post1'), false);
  assert.equal(isPep440Prerelease('2.34.2'), false);
});

test('PyPI name search ranks exact, word-boundary prefix, prefix, word-boundary substring, substring', () => {
  const index = createNameIndex(
    ['grequests', 'requestsaa', 'Requests-OAuthlib', 'types-requests', 'requests', 'httpx', 'requests_mock', 'request'].join('\n'),
  );
  assert.deepEqual(rankNames(index, 'requests', 10), [
    'requests',
    'requests_mock',
    'Requests-OAuthlib',
    'requestsaa',
    'types-requests',
    'grequests',
  ]);
  assert.deepEqual(rankNames(index, 'Requests.Mock', 10), ['requests_mock']);
  assert.deepEqual(rankNames(index, 'requests', 2), ['requests', 'requests_mock']);
  assert.deepEqual(rankNames(index, 'zzz', 10), []);
});
