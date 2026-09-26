import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registries, registryFor } from '../registries';

test('each package name links to its page on the official registry website', () => {
  const expected: [registry: string, name: string, url: string][] = [
    ['npm', '@types/node', 'https://www.npmjs.com/package/@types/node'],
    ['pypi', 'requests', 'https://pypi.org/project/requests/'],
    ['go', 'github.com/gin-gonic/gin', 'https://pkg.go.dev/github.com/gin-gonic/gin'],
    ['crates', 'serde_json', 'https://crates.io/crates/serde_json'],
    ['maven', 'com.google.guava:guava', 'https://central.sonatype.com/artifact/com.google.guava/guava'],
    ['nuget', 'Newtonsoft.Json', 'https://www.nuget.org/packages/Newtonsoft.Json'],
    ['rubygems', 'rails', 'https://rubygems.org/gems/rails'],
    ['packagist', 'monolog/monolog', 'https://packagist.org/packages/monolog/monolog'],
    ['pub', 'http', 'https://pub.dev/packages/http'],
    ['hex', 'phoenix', 'https://hex.pm/packages/phoenix'],
  ];
  for (const [registry, name, url] of expected) {
    assert.equal(registryFor(registry)!.pageUrl(name), url);
  }
  assert.deepEqual(
    registries.map((r) => r.id).filter((id) => !expected.some(([reg]) => reg === id)),
    [],
    'every registry has a link case',
  );
});
