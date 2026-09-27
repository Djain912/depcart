import { registries, registryFor } from './registries';
import type { PackageSpec } from './registries/types';
import { isValidName, isValidVersion } from './validation';

export interface Selection {
  registry: string;
  name: string;
  version: string;
}

export interface CommandBlock {
  registry: string;
  tool: string;
  kind: 'command' | 'snippet';
  command: string;
  count: number;
  /** Set when the program the command runs isn't installed (see toolCheck.ts). */
  missing?: MissingProgram;
}

export interface MissingProgram {
  program: string;
  /** What to install, e.g. "Node.js" for npm. */
  installName: string;
  /** An installed tool for the same language, offered only when the project doesn't require this one. */
  alternative?: { id: string; label: string };
}

/**
 * One block per registry, so packages from different ecosystems never share a command.
 * `toolIds` picks the install tool per registry; unknown or missing ids fall back to the registry's default.
 */
export function buildCommands(
  selections: Selection[],
  toolIds: Record<string, string | undefined>,
): { blocks: CommandBlock[]; rejected: Selection[] } {
  const groups = new Map<string, PackageSpec[]>();
  const rejected: Selection[] = [];
  for (const s of selections) {
    const registry = registryFor(s.registry);
    if (!isValidName(registry, s.name) || !isValidVersion(registry, s.version)) {
      rejected.push(s);
      continue;
    }
    groups.set(s.registry, [...(groups.get(s.registry) ?? []), { name: s.name, version: s.version }]);
  }
  const blocks = registries.flatMap((registry) => {
    const packages = groups.get(registry.id);
    if (!packages) {
      return [];
    }
    const tool = registry.tools.find((t) => t.id === toolIds[registry.id]) ?? registry.tools[0];
    return [{ registry: registry.id, tool: tool.id, kind: tool.kind, command: tool.build(packages), count: packages.length }];
  });
  return { blocks, rejected };
}
