import { promises as fs } from 'fs';
import * as path from 'path';
import type { InstallTool, Marker, Registry } from './registries/types';

/** Top-level file names of a project folder, read once per detection pass. */
export async function listProjectFiles(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function matchingFile(dir: string, files: string[], marker: Marker): Promise<string | undefined> {
  const candidates = marker.file.startsWith('*.')
    ? files.filter((f) => f.endsWith(marker.file.slice(1)))
    : files.filter((f) => f === marker.file);
  for (const file of candidates) {
    if (!marker.contains) {
      return file;
    }
    try {
      if (marker.contains.test(await fs.readFile(path.join(dir, file), 'utf8'))) {
        return file;
      }
    } catch {
      // Unreadable file: treat as not matching.
    }
  }
  return undefined;
}

export async function detectEcosystems(dir: string, files: string[], registries: Registry[]): Promise<string[]> {
  const found: string[] = [];
  for (const registry of registries) {
    for (const marker of registry.projectMarkers) {
      if (await matchingFile(dir, files, marker)) {
        found.push(registry.id);
        break;
      }
    }
  }
  return found;
}

/** The first tool (in the registry's order) whose marker file is present in the project. */
export async function detectTool(
  dir: string,
  files: string[],
  registry: Registry,
): Promise<{ tool: InstallTool; file: string } | undefined> {
  for (const tool of registry.tools) {
    for (const marker of tool.markers ?? []) {
      const file = await matchingFile(dir, files, marker);
      if (file) {
        return { tool, file };
      }
    }
  }
  return undefined;
}
