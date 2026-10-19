import { getJson, postJson } from './http';
import type { PackageHealth, PackageSummary, Registry } from './types';

// ecosyste.ms indexes every registry DepCart supports, with popularity data, behind one keyless API.
const API = 'https://packages.ecosyste.ms/api/v1';
const LOOKUP_BATCH = 25;

export interface LookupResult {
  name: string;
  latest_release_number?: string | null;
  latest_release_published_at?: string | null;
  description?: string | null;
  downloads?: number | null;
  downloads_period?: string | null;
  dependent_packages_count?: number | null;
  status?: string | null;
  repository_url?: string | null;
  repo_metadata?: { pushed_at?: string | null; archived?: boolean | null; stargazers_count?: number | null } | null;
}

const PERIODS: Record<string, PackageHealth['downloadsPeriod']> = { 'last-month': 'month', total: 'total' };

/** How the index spells names: PyPI's are normalized (PEP 503), NuGet's lowercased, the rest as published. */
function looseKey(registry: Registry, name: string): string {
  const lower = name.toLowerCase();
  return registry.ecosystems.ecosystem === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

/**
 * The record for each name: the exact spelling first, otherwise a case-insensitive (PyPI: normalized)
 * match, but only when exactly one package has it. npm has both "JSONStream" and "jsonstream".
 */
export function matchRecords<T extends { name: string }>(registry: Registry, names: string[], records: T[]): Map<string, T> {
  const exact = new Map<string, T>();
  const loose = new Map<string, T[]>();
  for (const record of records) {
    if (!exact.has(record.name)) {
      exact.set(record.name, record);
      const key = looseKey(registry, record.name);
      loose.set(key, [...(loose.get(key) ?? []), record]);
    }
  }
  const matched = new Map<string, T>();
  for (const name of names) {
    const candidates = loose.get(looseKey(registry, name));
    const record = exact.get(name) ?? (candidates?.length === 1 ? candidates[0] : undefined);
    if (record) {
      matched.set(name, record);
    }
  }
  return matched;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** "github.com/owner/repo" from a repository URL, or undefined when it isn't a plain web URL. */
function repositoryPath(url: string | null | undefined): string | undefined {
  try {
    const parsed = new URL(url ?? '');
    const path = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '').replace(/\.git$/, '');
    return /^https?:$/.test(parsed.protocol) && /^[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._-]+)+$/.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** The signals worth showing next to a search result; undefined when the index knows nothing useful. */
export function healthOf(registry: Registry, record: LookupResult): PackageHealth | undefined {
  const health: PackageHealth = {};
  const period = PERIODS[record.downloads_period ?? ''];
  if (isCount(record.downloads) && period) {
    health.downloads = record.downloads;
    health.downloadsPeriod = period;
  }
  // Zero is what the index reports for paths it doesn't track on their own, such as Go sub-packages.
  if (isCount(record.dependent_packages_count) && record.dependent_packages_count > 0) {
    health.dependents = record.dependent_packages_count;
  }
  // Without a version number the date isn't a release (seen on Go modules: "today" for a 2025 release).
  if (!registry.ecosystems.hideVersion && record.latest_release_number && isDate(record.latest_release_published_at)) {
    health.released = record.latest_release_published_at;
    health.releasedVersion = record.latest_release_number;
  }
  const repo = record.repo_metadata;
  if (isDate(repo?.pushed_at)) {
    health.committed = repo.pushed_at;
  }
  if (isCount(repo?.stargazers_count)) {
    health.stars = repo.stargazers_count;
  }
  if (repo?.archived === true) {
    health.archived = true;
  }
  if (health.committed || health.stars !== undefined) {
    health.repository = repositoryPath(record.repository_url);
  }
  if (record.status === 'deprecated') {
    health.deprecated = true;
  }
  return Object.values(health).some((v) => v !== undefined) ? health : undefined;
}

async function bulkLookup(registry: Registry, names: string[], signal: AbortSignal): Promise<LookupResult[]> {
  const records = await postJson<unknown>(`${API}/packages/bulk_lookup`, { names, ecosystem: registry.ecosystems.ecosystem }, signal);
  return Array.isArray(records) ? records.filter((r): r is LookupResult => typeof r?.name === 'string') : [];
}

/** Health for each name; null when the index has no record of it (or nothing useful to say). */
export async function ecosystemsHealth(registry: Registry, names: string[], signal: AbortSignal): Promise<Record<string, PackageHealth | null>> {
  const unique = [...new Set(names)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
    batches.push(unique.slice(i, i + LOOKUP_BATCH));
  }
  // Ask for the index's spelling too: it stores "flask" for PyPI's "Flask".
  const spellings = (batch: string[]) => [...new Set(batch.flatMap((n) => [n, n.toLowerCase(), looseKey(registry, n)]))];
  const records = (await Promise.all(batches.map((batch) => bulkLookup(registry, spellings(batch), signal)))).flat();
  const matched = matchRecords(registry, unique, records);
  return Object.fromEntries(unique.map((name) => [name, (matched.has(name) && healthOf(registry, matched.get(name)!)) || null]));
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
  const details = await bulkLookup(registry, found, signal).catch(() => [] as LookupResult[]);
  const byName = matchRecords(registry, found, details);
  return found.map((name) => {
    const detail = byName.get(name);
    const health = detail && healthOf(registry, detail);
    return {
      registry: registry.id,
      name,
      version: cfg.hideVersion ? '' : detail?.latest_release_number ?? '',
      description: detail?.description ?? '',
      via: 'ecosyste.ms',
      ...(health ? { health } : {}),
    };
  });
}
