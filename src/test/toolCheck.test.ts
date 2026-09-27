import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildCommands } from '../commandBuilder';
import { registries } from '../registries';
import { checkPrograms, isOnPath, type ProgramFinder } from '../toolCheck';

const installed = (...programs: string[]): ProgramFinder => async (p) => programs.includes(p);

function blocksFor(registry: string, tool: string, name: string, version: string) {
  return buildCommands([{ registry, name, version }], { [registry]: tool }).blocks;
}

test('every command tool names the program it runs and an https install guide', () => {
  const problems = registries.flatMap((r) =>
    r.tools
      .filter((t) => t.kind === 'command')
      .flatMap((t) => {
        const command = t.build([{ name: r.example.split(',')[0].trim(), version: '1.0.0' }]);
        if (!t.needs) return [`${r.id}/${t.id}: no needs`];
        if (!t.needs.installUrl.startsWith('https://')) return [`${r.id}/${t.id}: install URL`];
        if (!command.startsWith(`${t.needs.program} `)) return [`${r.id}/${t.id}: "${command}" doesn't start with ${t.needs.program}`];
        return [];
      }),
  );
  assert.deepEqual(problems, []);
});

test('an installed program leaves the block untouched', async () => {
  const blocks = blocksFor('npm', 'pnpm', 'zod', '4.6.5');
  const [checked] = await checkPrograms(blocks, { npm: 'detected' }, installed('pnpm', 'npm'));
  assert.deepEqual(checked, blocks[0]);
});

test('a missing program the project uses is flagged, without suggesting another tool', async () => {
  const blocks = blocksFor('npm', 'pnpm', 'zod', '4.6.5');
  const [checked] = await checkPrograms(blocks, { npm: 'detected' }, installed('npm'));
  assert.deepEqual(checked.missing, { program: 'pnpm', installName: 'pnpm', alternative: undefined });
  assert.equal(checked.command, 'pnpm add zod@4.6.5');
});

test('a missing default tool suggests an installed one for the same language', async () => {
  const blocks = blocksFor('npm', 'npm', 'zod', '4.6.5');
  const [checked] = await checkPrograms(blocks, { npm: 'default' }, installed('bun'));
  assert.deepEqual(checked.missing, { program: 'npm', installName: 'Node.js', alternative: { id: 'bun', label: 'bun' } });
});

test('pip falls back to pip3 by rewriting the command', async () => {
  const blocks = blocksFor('pypi', 'pip', 'requests', '2.34.2');
  const [checked] = await checkPrograms(blocks, { pypi: 'default' }, installed('pip3'));
  assert.equal(checked.missing, undefined);
  assert.equal(checked.command, 'pip3 install requests==2.34.2');
});

test('snippets never need a program', async () => {
  const blocks = blocksFor('maven', 'maven', 'com.google.guava:guava', '33.7.1-jre');
  const [checked] = await checkPrograms(blocks, {}, installed());
  assert.equal(checked.missing, undefined);
});

test('a warning clears once the program is installed', async () => {
  const blocks = blocksFor('crates', 'cargo', 'serde', '1.0.229');
  const [before] = await checkPrograms(blocks, {}, installed());
  assert.equal(before.missing?.program, 'cargo');
  const [after] = await checkPrograms([before], {}, installed('cargo'));
  assert.equal(after.missing, undefined);
});

test('finds programs on PATH the way this OS does, and ignores what is not there', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'depcart-path-'));
  try {
    const windows = process.platform === 'win32';
    if (windows) {
      await fs.writeFile(path.join(dir, 'fakepm.cmd'), '@echo off\r\n');
    } else {
      await fs.writeFile(path.join(dir, 'fakepm'), '#!/bin/sh\n', { mode: 0o755 });
      await fs.writeFile(path.join(dir, 'notexec'), '#!/bin/sh\n', { mode: 0o644 });
    }
    const env = windows ? { Path: `C:\\nowhere;${dir}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' } : { PATH: `/nowhere:${dir}` };
    assert.equal(await isOnPath('fakepm', env), true);
    assert.equal(await isOnPath('depcart-no-such-program', env), false);
    assert.equal(await isOnPath('fakepm', windows ? { Path: 'C:\\nowhere' } : { PATH: '/nowhere' }), false);
    if (!windows) {
      assert.equal(await isOnPath('notexec', env), false, 'a file without the execute bit is not a program');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
