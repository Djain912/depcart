import { isPrerelease, sortNewestFirst } from '../semver';
import { getJson, getText } from './http';
import type { Registry } from './types';
import { specs, versionList } from './util';

interface SearchResponse {
  crates: { name: string; max_stable_version?: string | null; newest_version: string; description?: string | null }[];
}

// crates.io's data access policy asks API clients to stay at or under one request per second.
const API_INTERVAL_MS = 1000;
let nextApiSlot = 0;

function waitForApiSlot(signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextApiSlot - now);
  nextApiSlot = Math.max(now, nextApiSlot) + API_INTERVAL_MS;
  if (!wait) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, wait);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Path of a crate's file in the sparse index, e.g. "se/rd/serde", "3/r/rand", "2/cc". */
function indexPath(name: string): string {
  const n = name.toLowerCase();
  if (n.length <= 2) {
    return `${n.length}/${n}`;
  }
  if (n.length === 3) {
    return `3/${n[0]}/${n}`;
  }
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

export const cratesRegistry: Registry = {
  id: 'crates',
  label: 'Rust',
  title: 'Rust crates from crates.io',
  example: 'serde_json, tokio',
  ecosystems: { registry: 'crates.io', ecosystem: 'cargo', sort: 'downloads' },
  projectMarkers: [{ file: 'Cargo.toml' }],
  namePattern: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
  versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  tools: [
    {
      id: 'cargo',
      label: 'cargo add',
      kind: 'command',
      needs: { program: 'cargo', installName: 'Rust (cargo)', installUrl: 'https://rust-lang.org/tools/install/' },
      build: (p) => `cargo add ${specs(p, '@')}`,
    },
  ],

  pageUrl: (name) => `https://crates.io/crates/${name}`,

  async search(query, limit, signal) {
    await waitForApiSlot(signal);
    const data = await getJson<SearchResponse>(
      `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${limit}`,
      signal,
    );
    return data.crates.map((c) => ({
      registry: 'crates',
      name: c.name,
      version: c.max_stable_version || c.newest_version,
      description: c.description ?? '',
    }));
  },

  async versions(name, signal) {
    // The sparse index is the CDN-backed source cargo itself uses; one JSON line per published version.
    const text = await getText(`https://index.crates.io/${indexPath(name)}`, signal);
    const published = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { vers: string; yanked: boolean })
      .filter((v) => !v.yanked)
      .map((v) => v.vers);
    return versionList(sortNewestFirst(published), undefined, isPrerelease);
  },
};
