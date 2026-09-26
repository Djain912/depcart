import { isPrerelease, sortNewestFirst } from '../semver';
import { HttpError, getJson, getText, request } from './http';
import type { PackageSummary, Registry, VersionList } from './types';
import { specs, versionList } from './util';

const SITE = 'https://pkg.go.dev';
const PROXY = 'https://proxy.golang.org';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      return String.fromCodePoint(hex ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Standard-library paths (net/http, fmt, ...) have no dot in the first element and can't be `go get`-ed. */
function isThirdParty(path: string): boolean {
  return path.split('/')[0].includes('.');
}

/** pkg.go.dev has no JSON search API, so results are read from its search page markup. */
export function parseSearchHtml(html: string): PackageSummary[] {
  const results: PackageSummary[] = [];
  for (const snippet of html.split('class="SearchSnippet"').slice(1)) {
    const rawPath =
      /class="SearchSnippet-header-path">\(([^)<]+)\)/.exec(snippet)?.[1] ??
      /data-clicked-package="([^"]+)"/.exec(snippet)?.[1];
    if (!rawPath) {
      continue;
    }
    const path = decodeEntities(rawPath.trim());
    if (!isThirdParty(path)) {
      continue;
    }
    const synopsis = /class="SearchSnippet-synopsis"[^>]*>([\s\S]*?)<\/p>/.exec(snippet)?.[1] ?? '';
    const shown = /<strong>(v[^<\s]+)<\/strong>\s*published/.exec(snippet)?.[1] ?? '';
    // Pseudo-versions are shortened for display ("v0.0.0-...-f3bf637"); the full one comes from the proxy.
    const version = shown.includes('...') ? '' : shown;
    results.push({ registry: 'go', name: path, version, description: cleanText(synopsis) });
  }
  return results;
}

/** The module proxy encodes uppercase letters as "!" + lowercase. */
function escapeModulePath(module: string): string {
  return module.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

async function orNotFound<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 410)) {
      return undefined;
    }
    throw e;
  }
}

async function moduleVersions(module: string, signal: AbortSignal): Promise<VersionList | undefined> {
  const base = `${PROXY}/${escapeModulePath(module)}`;
  // @latest applies Go's own selection rules and also covers modules with no tagged versions.
  const [listText, latest] = await Promise.all([
    orNotFound(getText(`${base}/@v/list`, signal)),
    orNotFound(getJson<{ Version: string }>(`${base}/@latest`, signal).then((info) => info.Version)),
  ]);
  if (listText === undefined) {
    return undefined;
  }
  const listed = listText.split('\n').map((v) => v.trim()).filter(Boolean);
  const versions = sortNewestFirst(latest && !listed.includes(latest) ? [...listed, latest] : listed);
  return versions.length ? versionList(versions, latest, isPrerelease) : undefined;
}

export const goRegistry: Registry = {
  id: 'go',
  label: 'Go',
  title: 'Go modules from pkg.go.dev and the Go module proxy',
  example: 'github.com/gin-gonic/gin, golang.org/x/sync',
  ecosystems: { registry: 'proxy.golang.org', ecosystem: 'go', sort: 'dependent_packages_count', lastSegmentSeparator: '/' },
  projectMarkers: [{ file: 'go.mod' }, { file: 'go.work' }],
  namePattern: /^[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9._~+-]+)*$/,
  versionPattern: /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  tools: [{ id: 'go', label: 'go get', kind: 'command', build: (p) => `go get ${specs(p, '@')}` }],

  pageUrl: (name) => `https://pkg.go.dev/${name}`,

  async search(query, limit, signal) {
    const res = await request(`${SITE}/search?q=${encodeURIComponent(query)}&m=package&limit=${limit}`, signal);
    const landedOn = decodeURIComponent(new URL(res.url).pathname).slice(1).split('@')[0];
    if (res.redirected && landedOn !== 'search') {
      // An exact import path redirects straight to that package's page.
      await res.body?.cancel();
      return isThirdParty(landedOn) ? [{ registry: 'go', name: landedOn, version: '', description: '' }] : [];
    }
    return parseSearchHtml(await res.text());
  },

  async versions(name, signal) {
    // A package path can live inside a module; walk up to the nearest path the proxy knows as a module.
    const segments = name.split('/');
    for (let n = segments.length; n > 0; n--) {
      const found = await moduleVersions(segments.slice(0, n).join('/'), signal);
      if (found) {
        return found;
      }
    }
    throw new Error(`No Go module found for ${name}`);
  },
};
