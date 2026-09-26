import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommands, type Selection } from '../commandBuilder';

test('each language gets its own block, in registry order', () => {
  const selections: Selection[] = [
    { registry: 'go', name: 'github.com/gin-gonic/gin', version: 'v1.12.0' },
    { registry: 'npm', name: 'react', version: '19.1.0' },
    { registry: 'pypi', name: 'requests', version: '2.34.2' },
    { registry: 'npm', name: '@types/node', version: '20.19.43' },
    { registry: 'crates', name: 'serde', version: '1.0.229' },
  ];
  const { blocks, rejected } = buildCommands(selections, {});
  assert.deepEqual(rejected, []);
  assert.deepEqual(
    blocks.map((b) => [b.registry, b.command, b.count]),
    [
      ['npm', 'npm install react@19.1.0 @types/node@20.19.43', 2],
      ['pypi', 'pip install requests==2.34.2', 1],
      ['go', 'go get github.com/gin-gonic/gin@v1.12.0', 1],
      ['crates', 'cargo add serde@1.0.229', 1],
    ],
  );
});

test('the chosen tool is used; unknown tool ids fall back to the default', () => {
  const selections: Selection[] = [{ registry: 'npm', name: 'lodash', version: '4.17.21' }];
  assert.equal(buildCommands(selections, { npm: 'pnpm' }).blocks[0].command, 'pnpm add lodash@4.17.21');
  assert.equal(buildCommands(selections, { npm: 'not-a-tool' }).blocks[0].command, 'npm install lodash@4.17.21');
});

test('snippet tools are marked as snippets', () => {
  const { blocks } = buildCommands([{ registry: 'maven', name: 'com.google.guava:guava', version: '33.7.1-jre' }], {});
  assert.equal(blocks[0].kind, 'snippet');
});

test('anything that could inject shell syntax or flags is rejected', () => {
  const bad: Selection[] = [
    { registry: 'npm', name: 'left-pad; rm -rf ~', version: '1.0.0' },
    { registry: 'npm', name: '-g', version: '1.0.0' },
    { registry: 'npm', name: 'react', version: '1.0.0 && calc' },
    { registry: 'npm', name: 'react', version: '$(whoami)' },
    { registry: 'go', name: 'github.com/x/y|more', version: 'v1.0.0' },
    { registry: 'go', name: '--insecure', version: 'v1.0.0' },
    { registry: 'go', name: 'github.com/x/y', version: '1.0.0' },
    { registry: 'pypi', name: 'requests', version: '1!2.0' },
    { registry: 'pypi', name: 'requests', version: '2.0 --index-url=http://evil' },
    { registry: 'nuget', name: 'Foo', version: '1.0.0" /><Evil a="' },
    { registry: 'maven', name: 'com.x:y</artifactId>', version: '1.0' },
    { registry: 'rubygems', name: 'rails', version: '8.0`id`' },
    { registry: 'hex', name: 'phoenix', version: '1.0.0"} ++ System.cmd("x"' },
    { registry: 'unknown', name: 'requests', version: '2.0.0' },
  ];
  const { blocks, rejected } = buildCommands(bad, {});
  assert.deepEqual(blocks, []);
  assert.equal(rejected.length, bad.length);
});
