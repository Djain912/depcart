import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankDocs } from '../registries/maven';

test('exact artifact matches first, then by published version count, de-duplicated', () => {
  const docs = [
    { g: 'io.github.someone', a: 'jackson-databind', versionCount: 0 },
    { g: 'com.jwebmp', a: 'jackson-databind-extras', versionCount: 300 },
    { g: 'com.fasterxml.jackson.core', a: 'jackson-databind', versionCount: 0 },
    { g: 'com.fasterxml.jackson.core', a: 'jackson-databind', versionCount: 214 },
    { g: 'tools.jackson.core', a: 'jackson-databind', versionCount: 12 },
  ];
  assert.deepEqual(rankDocs(docs, 'Jackson Databind'), [
    'com.fasterxml.jackson.core:jackson-databind',
    'tools.jackson.core:jackson-databind',
    'io.github.someone:jackson-databind',
    'com.jwebmp:jackson-databind-extras',
  ]);
});

test('group:artifact queries match on the artifact part', () => {
  const docs = [
    { g: 'org.junit.jupiter', a: 'junit-jupiter-api' },
    { g: 'org.junit.jupiter', a: 'junit-jupiter' },
  ];
  assert.deepEqual(rankDocs(docs, 'org.junit.jupiter:junit-jupiter'), ['org.junit.jupiter:junit-jupiter', 'org.junit.jupiter:junit-jupiter-api']);
});
