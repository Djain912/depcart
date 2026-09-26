import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSuggestionPrompt, parseSuggestions } from '../aiSuggestions';
import { registryFor } from '../registries';

const targets = [registryFor('npm')!, registryFor('maven')!, registryFor('pypi')!];

test('the prompt names each registry, its name format and the search text', () => {
  const prompt = buildSuggestionPrompt(targets, 'schema validation');
  assert.match(prompt, /"schema validation"/);
  assert.match(prompt, /"maven": .*com\.google\.guava:guava/);
  assert.match(prompt, /JSON object/);
});

test('parses a fenced reply and keeps only valid, unique names per registry', () => {
  const reply = [
    'Here you go:',
    '```json',
    JSON.stringify({
      npm: ['zod', 'zod', 'yup', 'rm -rf /', '-g'],
      maven: ['org.hibernate.validator:hibernate-validator', 'not a coordinate'],
      pypi: 'pydantic',
      crates: ['validator'],
    }),
    '```',
  ].join('\n');
  assert.deepEqual(parseSuggestions(reply, targets), {
    npm: ['zod', 'yup'],
    maven: ['org.hibernate.validator:hibernate-validator'],
  });
});

test('unparseable replies give no suggestions', () => {
  assert.deepEqual(parseSuggestions('I am not sure.', targets), {});
  assert.deepEqual(parseSuggestions('{"npm": [zod]}', targets), {});
});
