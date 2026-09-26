import { isPrerelease } from '../semver';
import { getJson } from './http';
import type { Registry } from './types';
import { versionList } from './util';

const API = 'https://hex.pm/api';

interface HexPackage {
  name: string;
  latest_stable_version?: string | null;
  latest_version?: string | null;
  meta?: { description?: string | null };
  releases: { version: string }[];
}

export const hexRegistry: Registry = {
  id: 'hex',
  label: 'Elixir',
  title: 'Elixir / Erlang packages from Hex',
  example: 'phoenix, ecto_sql',
  ecosystems: { registry: 'hex.pm', ecosystem: 'hex', sort: 'downloads' },
  projectMarkers: [{ file: 'mix.exs' }],
  namePattern: /^[a-z][a-z0-9_]*$/,
  versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  // Mix has no "add dependency" command; a bare version string in deps means an exact match.
  tools: [
    {
      id: 'mix',
      label: 'mix.exs',
      kind: 'snippet',
      build: (p) => p.map((x) => `{:${x.name}, "${x.version}"}`).join(',\n'),
    },
  ],

  pageUrl: (name) => `https://hex.pm/packages/${name}`,

  async search(query, limit, signal) {
    const packages = await getJson<HexPackage[]>(
      `${API}/packages?search=${encodeURIComponent(query)}&sort=recent_downloads`,
      signal,
    );
    return packages.slice(0, limit).map((p) => ({
      registry: 'hex',
      name: p.name,
      version: p.latest_stable_version ?? p.latest_version ?? '',
      description: p.meta?.description ?? '',
    }));
  },

  async versions(name, signal) {
    const p = await getJson<HexPackage>(`${API}/packages/${name}`, signal);
    return versionList(
      p.releases.map((r) => r.version),
      p.latest_stable_version ?? undefined,
      isPrerelease,
    );
  },
};
