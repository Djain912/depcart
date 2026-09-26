import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommands } from '../commandBuilder';
import { registries } from '../registries';
import type { PackageSpec } from '../registries/types';

const npmPkgs = [
  { name: 'zod', version: '4.5.0' },
  { name: '@types/node', version: '26.6.2' },
];
const pyPkgs = [
  { name: 'requests', version: '2.34.2' },
  { name: 'zope.interface', version: '7.2rc1' },
];
const gems = [
  { name: 'rails', version: '8.1.4' },
  { name: 'puma', version: '7.0.0.beta1' },
];
const nugets = [
  { name: 'Newtonsoft.Json', version: '13.0.4' },
  { name: 'Serilog', version: '4.3.0-dev-02364' },
];
const jars = [
  { name: 'com.google.guava:guava', version: '33.7.1-jre' },
  { name: 'org.junit.jupiter:junit-jupiter', version: '5.13.4' },
];
const dartPkgs = [
  { name: 'http', version: '1.6.0' },
  { name: 'path', version: '0.2.7+0' },
];

// Real package names and versions, so this also checks each registry accepts what it serves.
const cases: [registry: string, tool: string, packages: PackageSpec[], expected: string][] = [
  ['npm', 'npm', npmPkgs, 'npm install zod@4.5.0 @types/node@26.6.2'],
  ['npm', 'yarn', npmPkgs, 'yarn add zod@4.5.0 @types/node@26.6.2'],
  ['npm', 'pnpm', npmPkgs, 'pnpm add zod@4.5.0 @types/node@26.6.2'],
  ['npm', 'bun', npmPkgs, 'bun add zod@4.5.0 @types/node@26.6.2'],
  ['npm', 'deno', npmPkgs, 'deno add npm:zod@4.5.0 npm:@types/node@26.6.2'],
  ['pypi', 'pip', pyPkgs, 'pip install requests==2.34.2 zope.interface==7.2rc1'],
  ['pypi', 'uv', pyPkgs, 'uv add requests==2.34.2 zope.interface==7.2rc1'],
  ['pypi', 'poetry', pyPkgs, 'poetry add requests==2.34.2 zope.interface==7.2rc1'],
  ['pypi', 'pipenv', pyPkgs, 'pipenv install requests==2.34.2 zope.interface==7.2rc1'],
  ['pypi', 'pdm', pyPkgs, 'pdm add requests==2.34.2 zope.interface==7.2rc1'],
  [
    'go',
    'go',
    [
      { name: 'github.com/gin-gonic/gin', version: 'v1.12.0' },
      { name: 'github.com/BurntSushi/toml', version: 'v0.0.0-20240101120000-abcdef123456' },
    ],
    'go get github.com/gin-gonic/gin@v1.12.0 github.com/BurntSushi/toml@v0.0.0-20240101120000-abcdef123456',
  ],
  [
    'crates',
    'cargo',
    [
      { name: 'serde', version: '1.0.229' },
      { name: 'tokio', version: '1.47.1' },
    ],
    'cargo add serde@1.0.229 tokio@1.47.1',
  ],
  ['maven', 'maven', jars.slice(0, 1), '<dependency>\n  <groupId>com.google.guava</groupId>\n  <artifactId>guava</artifactId>\n  <version>33.7.1-jre</version>\n</dependency>'],
  ['maven', 'gradle-kotlin', jars, 'implementation("com.google.guava:guava:33.7.1-jre")\nimplementation("org.junit.jupiter:junit-jupiter:5.13.4")'],
  ['maven', 'gradle-groovy', jars, "implementation 'com.google.guava:guava:33.7.1-jre'\nimplementation 'org.junit.jupiter:junit-jupiter:5.13.4'"],
  ['nuget', 'dotnet', nugets, 'dotnet add package Newtonsoft.Json --version 13.0.4\ndotnet add package Serilog --version 4.3.0-dev-02364'],
  ['nuget', 'paket', nugets, 'paket add Newtonsoft.Json --version 13.0.4\npaket add Serilog --version 4.3.0-dev-02364'],
  [
    'nuget',
    'packagereference',
    nugets,
    '<PackageReference Include="Newtonsoft.Json" Version="13.0.4" />\n<PackageReference Include="Serilog" Version="4.3.0-dev-02364" />',
  ],
  ['rubygems', 'gem', gems, 'gem install rails:8.1.4 puma:7.0.0.beta1'],
  ['rubygems', 'bundler', gems, 'bundle add rails --version 8.1.4\nbundle add puma --version 7.0.0.beta1'],
  [
    'packagist',
    'composer',
    [
      { name: 'monolog/monolog', version: '3.9.0' },
      { name: 'symfony/console', version: 'v8.1.7' },
    ],
    'composer require monolog/monolog:3.9.0 symfony/console:v8.1.7',
  ],
  ['pub', 'dart', dartPkgs, 'dart pub add http:1.6.0 path:0.2.7+0'],
  ['pub', 'flutter', dartPkgs, 'flutter pub add http:1.6.0 path:0.2.7+0'],
  [
    'hex',
    'mix',
    [
      { name: 'phoenix', version: '1.8.15' },
      { name: 'ecto_sql', version: '3.13.2' },
    ],
    '{:phoenix, "1.8.15"},\n{:ecto_sql, "3.13.2"}',
  ],
];

for (const [registry, tool, packages, expected] of cases) {
  test(`${registry} / ${tool}`, () => {
    const { blocks, rejected } = buildCommands(
      packages.map((p) => ({ registry, ...p })),
      { [registry]: tool },
    );
    assert.deepEqual(rejected, []);
    assert.equal(blocks[0].tool, tool);
    assert.equal(blocks[0].command, expected);
  });
}

test('every install tool of every registry has a case above', () => {
  const missing = registries.flatMap((r) =>
    r.tools.filter((t) => !cases.some(([reg, tool]) => reg === r.id && tool === t.id)).map((t) => `${r.id}/${t.id}`),
  );
  assert.deepEqual(missing, []);
});
