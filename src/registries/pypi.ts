import { promises as fs } from 'fs';
import * as path from 'path';
import { comparePep440, isPep440Prerelease } from '../pep440';
import { HttpError, getJson } from './http';
import type { PackageSummary, Registry } from './types';
import { specs, versionList } from './util';

const PYPI = 'https://pypi.org';
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_TIMEOUT_MS = 120_000;

interface ProjectJson {
  info: { name: string; version: string; summary?: string | null };
  releases: Record<string, { yanked?: boolean }[]>;
}

/** Same-length normalization (PEP 503 minus run-collapsing) so offsets line up with the raw name list. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[_.]/g, '-');
}

interface NameIndex {
  raw: string;
  normalized: string;
}

/** `raw` is newline-separated project names. */
export function createNameIndex(raw: string): NameIndex {
  return { raw, normalized: normalize(raw) };
}

/**
 * No popularity data is available, so matches are ranked by shape: exact, then "query-…", other
 * prefixes, "…-query…", other substrings; shorter names first within each group.
 */
export function rankNames(index: NameIndex, query: string, limit: number): string[] {
  const q = normalize(query.trim());
  if (!q) {
    return [];
  }
  const hits: { name: string; rank: number }[] = [];
  let at = index.normalized.indexOf(q);
  while (at !== -1) {
    const start = index.normalized.lastIndexOf('\n', at) + 1;
    const newline = index.normalized.indexOf('\n', at);
    const end = newline === -1 ? index.normalized.length : newline;
    const after = index.normalized[at + q.length];
    const rank =
      at === start
        ? end - start === q.length
          ? 0
          : after === '-'
            ? 1
            : 2
        : index.normalized[at - 1] === '-'
          ? 3
          : 4;
    hits.push({ name: index.raw.slice(start, end), rank });
    if (newline === -1) {
      break;
    }
    at = index.normalized.indexOf(q, newline);
  }
  hits.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map((h) => h.name);
}

let cacheFile: string | undefined;
let indexPromise: Promise<NameIndex> | undefined;
let loadedIndex: NameIndex | undefined;

/** Where the downloaded PyPI name list is cached between sessions. */
export function setPypiIndexCacheFile(file: string): void {
  cacheFile = file;
}

async function readCachedNames(): Promise<string | undefined> {
  if (!cacheFile) {
    return undefined;
  }
  try {
    const stat = await fs.stat(cacheFile);
    return Date.now() - stat.mtimeMs < INDEX_MAX_AGE_MS ? await fs.readFile(cacheFile, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

async function loadIndex(): Promise<NameIndex> {
  let raw = await readCachedNames();
  if (raw === undefined) {
    // PyPI's search page sits behind a bot challenge, so search runs locally over the official
    // simple-index name list (~10 MB compressed), downloaded once and cached.
    const data = await getJson<{ projects: { name: string }[] }>(
      `${PYPI}/simple/`,
      AbortSignal.timeout(INDEX_TIMEOUT_MS),
      { Accept: 'application/vnd.pypi.simple.v1+json' },
    );
    raw = data.projects.map((p) => p.name).join('\n');
    if (cacheFile) {
      const file = cacheFile;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, raw).catch(() => undefined);
    }
  }
  return createNameIndex(raw);
}

/** Starts loading the name index in the background; not tied to any search so typing can't cancel it. */
function warmNameIndex(): void {
  indexPromise ??= loadIndex().then(
    (index) => (loadedIndex = index),
    (e) => {
      indexPromise = undefined;
      throw e;
    },
  );
  indexPromise.catch(() => undefined);
}

async function project(name: string, signal: AbortSignal): Promise<ProjectJson | undefined> {
  try {
    return await getJson<ProjectJson>(`${PYPI}/pypi/${encodeURIComponent(name)}/json`, signal);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      return undefined;
    }
    throw e;
  }
}

export const pypiRegistry: Registry = {
  id: 'pypi',
  label: 'Python',
  title: 'Python packages from PyPI',
  example: 'requests, scikit-learn',
  // PyPI's own search is behind a bot challenge; the index is popularity-ranked and has descriptions.
  ecosystems: { registry: 'pypi.org', ecosystem: 'pypi', sort: 'downloads', preferred: true },
  projectMarkers: [{ file: 'pyproject.toml' }, { file: 'requirements.txt' }, { file: 'setup.py' }, { file: 'Pipfile' }],
  namePattern: /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
  versionPattern: /^\d[0-9A-Za-z.+_-]*$/,
  tools: [
    { id: 'pip', label: 'pip', kind: 'command', build: (p) => `pip install ${specs(p, '==')}` },
    {
      id: 'uv',
      label: 'uv',
      kind: 'command',
      markers: [{ file: 'uv.lock' }, { file: 'pyproject.toml', contains: /^\[tool\.uv/m }],
      build: (p) => `uv add ${specs(p, '==')}`,
    },
    {
      id: 'poetry',
      label: 'poetry',
      kind: 'command',
      markers: [{ file: 'poetry.lock' }, { file: 'pyproject.toml', contains: /^\[tool\.poetry/m }],
      build: (p) => `poetry add ${specs(p, '==')}`,
    },
    {
      id: 'pipenv',
      label: 'pipenv',
      kind: 'command',
      markers: [{ file: 'Pipfile' }, { file: 'Pipfile.lock' }],
      build: (p) => `pipenv install ${specs(p, '==')}`,
    },
    {
      id: 'pdm',
      label: 'pdm',
      kind: 'command',
      markers: [{ file: 'pdm.lock' }, { file: 'pyproject.toml', contains: /^\[tool\.pdm/m }],
      build: (p) => `pdm add ${specs(p, '==')}`,
    },
  ],

  pageUrl: (name) => `https://pypi.org/project/${name}/`,

  async search(query, limit, signal) {
    // Never waits for the ~10 MB name index: until it has loaded, only an exact name match is found.
    if (!loadedIndex) {
      warmNameIndex();
    }
    const exact = await project(query.trim(), signal).catch(() => undefined);
    const names = loadedIndex ? rankNames(loadedIndex, query, limit) : [];
    const results: PackageSummary[] = names.map((name) => ({ registry: 'pypi', name, version: '', description: '' }));
    if (exact) {
      const key = normalize(exact.info.name);
      const rest = results.filter((r) => normalize(r.name) !== key);
      return [
        { registry: 'pypi', name: exact.info.name, version: exact.info.version, description: exact.info.summary ?? '' },
        ...rest,
      ].slice(0, limit);
    }
    return results;
  },

  async versions(name, signal) {
    const data = await project(name, signal);
    if (!data) {
      throw new Error(`${name} is not on PyPI`);
    }
    const installable = Object.entries(data.releases)
      .filter(([, files]) => files.length > 0 && !files.every((f) => f.yanked))
      .map(([version]) => version)
      .sort((a, b) => comparePep440(b, a));
    return versionList(installable, data.info.version, isPep440Prerelease);
  },
};
