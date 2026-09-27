import { isPrerelease, sortNewestFirst } from '../semver';
import { getJson } from './http';
import type { Registry } from './types';
import { packageJsonManager, specs, versionList } from './util';

const REGISTRY = 'https://registry.npmjs.org';

interface SearchResponse {
  objects: { package: { name: string; version: string; description?: string } }[];
}

interface AbbreviatedPackument {
  'dist-tags': Record<string, string>;
  versions: Record<string, unknown>;
}

export const npmRegistry: Registry = {
  id: 'npm',
  label: 'npm',
  title: 'JavaScript / TypeScript packages from the npm registry',
  example: 'zod, @types/node',
  ecosystems: { registry: 'npmjs.org', ecosystem: 'npm', sort: 'downloads' },
  projectMarkers: [{ file: 'package.json' }],
  namePattern: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._~-]*$/,
  versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  tools: [
    {
      id: 'npm',
      label: 'npm',
      kind: 'command',
      needs: { program: 'npm', installName: 'Node.js', installUrl: 'https://nodejs.org/en/download' },
      markers: [{ file: 'package-lock.json' }],
      build: (p) => `npm install ${specs(p, '@')}`,
    },
    {
      id: 'yarn',
      label: 'yarn',
      kind: 'command',
      markers: [{ file: 'yarn.lock' }, { file: '.yarnrc.yml' }, packageJsonManager('yarn')],
      needs: { program: 'yarn', installName: 'Yarn', installUrl: 'https://yarnpkg.com/getting-started/install' },
      build: (p) => `yarn add ${specs(p, '@')}`,
    },
    {
      id: 'pnpm',
      label: 'pnpm',
      kind: 'command',
      markers: [{ file: 'pnpm-lock.yaml' }, { file: 'pnpm-workspace.yaml' }, packageJsonManager('pnpm')],
      needs: { program: 'pnpm', installName: 'pnpm', installUrl: 'https://pnpm.io/installation' },
      build: (p) => `pnpm add ${specs(p, '@')}`,
    },
    {
      id: 'bun',
      label: 'bun',
      kind: 'command',
      markers: [{ file: 'bun.lock' }, { file: 'bun.lockb' }, packageJsonManager('bun')],
      needs: { program: 'bun', installName: 'Bun', installUrl: 'https://bun.sh/docs/installation' },
      build: (p) => `bun add ${specs(p, '@')}`,
    },
    {
      id: 'deno',
      label: 'deno',
      kind: 'command',
      markers: [{ file: 'deno.json' }, { file: 'deno.jsonc' }, { file: 'deno.lock' }],
      needs: { program: 'deno', installName: 'Deno', installUrl: 'https://docs.deno.com/runtime/getting_started/installation/' },
      build: (p) => `deno add ${p.map((x) => `npm:${x.name}@${x.version}`).join(' ')}`,
    },
  ],

  pageUrl: (name) => `https://www.npmjs.com/package/${name}`,

  async search(query, limit, signal) {
    const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
    const data = await getJson<SearchResponse>(url, signal);
    return data.objects.map(({ package: p }) => ({
      registry: 'npm',
      name: p.name,
      version: p.version,
      description: p.description ?? '',
    }));
  },

  async versions(name, signal) {
    // Scoped names keep their leading "@" but the slash must be encoded: @scope%2Fname.
    const url = `${REGISTRY}/${encodeURIComponent(name).replace(/^%40/, '@')}`;
    const doc = await getJson<AbbreviatedPackument>(url, signal, { Accept: 'application/vnd.npm.install-v1+json' });
    return versionList(sortNewestFirst(Object.keys(doc.versions)), doc['dist-tags'].latest, isPrerelease);
  },
};
