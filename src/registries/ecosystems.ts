import { getJson, postJson } from './http';
import type { PackageSummary, Registry } from './types';

// ecosyste.ms indexes every registry DepCart supports, with popularity data, behind one keyless API.
const API = 'https://packages.ecosyste.ms/api/v1';

interface LookupResult {
  name: string;
  latest_release_number?: string | null;
  description?: string | null;
}

/** Names matching the query (by last segment and by prefix), most popular first, with descriptions. */
export async function ecosystemsSearch(registry: Registry, query: string, limit: number, signal: AbortSignal): Promise<PackageSummary[]> {
  const cfg = registry.ecosystems;
  const term = query.trim().toLowerCase().replace(/\s+/g, '-');
  if (!term) {
    return [];
  }
  const names = (param: 'prefix' | 'postfix', value: string) =>
    getJson<string[]>(
      `${API}/registries/${cfg.registry}/package_names?${param}=${encodeURIComponent(value)}&sort=${cfg.sort}&order=desc&per_page=${limit}`,
      signal,
    );
  const [bySegment, byPrefix] = await Promise.all([
    cfg.lastSegmentSeparator ? names('postfix', cfg.lastSegmentSeparator + term) : Promise.resolve([]),
    names('prefix', term),
  ]);
  const found = [...new Set([...bySegment, ...byPrefix])].slice(0, limit);
  if (!found.length) {
    return [];
  }
  // Details are a nice-to-have: without them the names are still useful.
  const details = await postJson<LookupResult[]>(`${API}/packages/bulk_lookup`, { names: found, ecosystem: cfg.ecosystem }, signal).catch(
    () => [] as LookupResult[],
  );
  const byName = new Map(details.map((d) => [d.name.toLowerCase(), d]));
  return found.map((name) => {
    const detail = byName.get(name.toLowerCase());
    return {
      registry: registry.id,
      name,
      version: cfg.hideVersion ? '' : detail?.latest_release_number ?? '',
      description: detail?.description ?? '',
      via: 'ecosyste.ms',
    };
  });
}
