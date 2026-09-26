import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { detectEcosystems, detectTool, listProjectFiles } from '../detect';
import { registries, registryFor } from '../registries';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'depcart-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test('detects ecosystems and tools from lockfiles and file contents', async () => {
  const dir = project({
    'package.json': '{ "name": "app" }',
    'pnpm-lock.yaml': '',
    'pyproject.toml': '[project]\nname = "app"\n\n[tool.poetry]\npackage-mode = false\n',
    'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n',
    'App.csproj': '<Project />',
  });
  const files = await listProjectFiles(dir);
  assert.deepEqual(await detectEcosystems(dir, files, registries), ['npm', 'pypi', 'nuget', 'pub']);
  assert.equal((await detectTool(dir, files, registryFor('npm')!))?.tool.id, 'pnpm');
  assert.equal((await detectTool(dir, files, registryFor('pypi')!))?.tool.id, 'poetry');
  assert.equal((await detectTool(dir, files, registryFor('pub')!))?.tool.id, 'flutter');
  assert.equal(await detectTool(dir, files, registryFor('nuget')!), undefined);
});

test('packageManager in package.json picks the npm client when there is no lockfile', async () => {
  const dir = project({ 'package.json': '{ "packageManager": "yarn@4.9.2" }' });
  const detected = await detectTool(dir, await listProjectFiles(dir), registryFor('npm')!);
  assert.deepEqual([detected?.tool.id, detected?.file], ['yarn', 'package.json']);
});

test('a missing folder detects nothing', async () => {
  assert.deepEqual(await listProjectFiles(join(tmpdir(), 'depcart-does-not-exist')), []);
});
