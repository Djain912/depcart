import { constants, promises as fs } from 'fs';
import * as path from 'path';
import type { CommandBlock } from './commandBuilder';
import { registryFor } from './registries';

/** Whether a program can be found. Injected so tests don't depend on the machine's PATH. */
export type ProgramFinder = (program: string) => Promise<boolean>;

/** Where the block's tool came from. A tool the project itself uses is never swapped for another. */
export type ToolSource = 'chosen' | 'detected' | 'default';

/**
 * Looks for a program on PATH the way a shell does (with PATHEXT on Windows), without running anything.
 * The terminal's PATH can differ from the extension host's (shell profiles, a PATH changed since VS Code
 * started), so a miss is only ever a warning.
 */
export async function isOnPath(program: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const windows = platform === 'win32';
  const key = Object.keys(env).find((k) => (windows ? k.toUpperCase() === 'PATH' : k === 'PATH'));
  const dirs = (key ? (env[key] ?? '') : '').split(windows ? ';' : ':').filter(Boolean);
  // PowerShell, VS Code's default terminal on Windows, also runs .ps1 scripts found on PATH.
  const extensions = windows ? [...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '.PS1'] : [''];
  const candidates = dirs.flatMap((dir) => extensions.map((ext) => path.join(dir.replace(/^"(.*)"$/, '$1'), program + ext)));
  const found = await Promise.all(candidates.map((file) => isExecutableFile(file, windows)));
  return found.includes(true);
}

async function isExecutableFile(file: string, windows: boolean): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) {
      return false;
    }
    if (!windows) {
      await fs.access(file, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

const CACHE_MS = 30_000;
const cache = new Map<string, { found: boolean; at: number }>();

/** A PATH lookup with a short cache; `fresh` skips it, e.g. right before running a command. */
export function pathFinder(fresh = false): ProgramFinder {
  return async (program) => {
    const hit = cache.get(program);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
      return hit.found;
    }
    const found = await isOnPath(program);
    cache.set(program, { found, at: Date.now() });
    return found;
  };
}

/**
 * Checks the program each command block runs. When it's missing, the block says what to install and,
 * unless the project itself uses this tool, which installed tool could be used instead. A program that
 * goes by another name (pip → pip3) is used under that name instead.
 */
export async function checkPrograms(blocks: CommandBlock[], sources: Record<string, ToolSource | undefined>, find: ProgramFinder): Promise<CommandBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      const registry = registryFor(block.registry);
      const tool = registry?.tools.find((t) => t.id === block.tool);
      const needs = tool?.needs;
      if (!registry || !tool || !needs || block.kind !== 'command') {
        return block;
      }
      const { missing: _stale, ...rest } = block;
      if (await find(needs.program)) {
        return rest;
      }
      for (const alias of needs.alternatives ?? []) {
        if (await find(alias)) {
          const command = rest.command
            .split('\n')
            .map((line) => (line.startsWith(`${needs.program} `) ? alias + line.slice(needs.program.length) : line))
            .join('\n');
          return { ...rest, command };
        }
      }
      let alternative: { id: string; label: string } | undefined;
      if (sources[block.registry] !== 'detected') {
        for (const other of registry.tools) {
          if (other.id !== tool.id && other.kind === 'command' && other.needs && (await find(other.needs.program))) {
            alternative = { id: other.id, label: other.label };
            break;
          }
        }
      }
      return { ...rest, missing: { program: needs.program, installName: needs.installName, alternative } };
    }),
  );
}
