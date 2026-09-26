import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrerelease, sortNewestFirst } from '../semver';

test('sorts numerically, releases above their prereleases', () => {
  assert.deepEqual(sortNewestFirst(['1.2.0', '1.10.0', '1.2.0-beta.2', '1.2.0-beta.10', '2.0.0-rc.1', '1.2.0-alpha']), [
    '2.0.0-rc.1',
    '1.10.0',
    '1.2.0',
    '1.2.0-beta.10',
    '1.2.0-beta.2',
    '1.2.0-alpha',
  ]);
});

test('handles unsorted Go proxy output with v prefixes', () => {
  assert.deepEqual(sortNewestFirst(['v1.8.1', 'v1.10.1', 'v1.6.2', 'v1.12.0', 'v1.7.4']), [
    'v1.12.0',
    'v1.10.1',
    'v1.8.1',
    'v1.7.4',
    'v1.6.2',
  ]);
});

test('detects prereleases', () => {
  assert.equal(isPrerelease('v0.0.0-20240101120000-abcdef123456'), true);
  assert.equal(isPrerelease('1.0.0'), false);
  assert.equal(isPrerelease('v2.0.0+incompatible'), false);
});
