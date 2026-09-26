import { getJson } from './http';
import type { Registry } from './types';
import { specs, versionList } from './util';

/** Composer stability flags; "-p1"/"-patch1" are stable patch releases. */
const isPrerelease = (v: string) => /-(?:dev|alpha|a|beta|b|rc)[.\d]*$/i.test(v);

export const packagistRegistry: Registry = {
  id: 'packagist',
  label: 'PHP',
  title: 'PHP packages from Packagist (Composer)',
  example: 'monolog/monolog, symfony/console',
  ecosystems: { registry: 'packagist.org', ecosystem: 'packagist', sort: 'downloads', lastSegmentSeparator: '/' },
  projectMarkers: [{ file: 'composer.json' }],
  namePattern: /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/,
  versionPattern: /^v?\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?$/,
  tools: [{ id: 'composer', label: 'composer', kind: 'command', build: (p) => `composer require ${specs(p, ':')}` }],

  pageUrl: (name) => `https://packagist.org/packages/${name}`,

  async search(query, limit, signal) {
    const data = await getJson<{ results: { name: string; description?: string }[] }>(
      `https://packagist.org/search.json?q=${encodeURIComponent(query)}&per_page=${limit}`,
      signal,
    );
    return data.results.map((r) => ({ registry: 'packagist', name: r.name, version: '', description: r.description ?? '' }));
  },

  async versions(name, signal) {
    // Composer v2 metadata: tagged releases only (dev branches live in a separate ~dev file), newest first.
    const data = await getJson<{ packages: Record<string, { version: string }[]> }>(
      `https://repo.packagist.org/p2/${name}.json`,
      signal,
    );
    return versionList(
      (data.packages[name] ?? []).map((v) => v.version),
      undefined,
      isPrerelease,
    );
  },
};
