import { getJson, getText } from './http';
import type { PackageSpec, Registry } from './types';
import { perPackage, versionList } from './util';

const LEGACY_SEARCH = 'https://search.maven.org/solrsearch/select';
const CENTRAL_SEARCH = 'https://central.sonatype.com/solrsearch/select';
const LEGACY_BUDGET_MS = 4000;

const isPrerelease = (v: string) => /(?:^|[.-])(?:alpha|beta|rc|cr|m\d+|milestone|snapshot|preview|ea|incubating)/i.test(v);

interface Doc {
  g: string;
  a: string;
  /** Only search.maven.org fills this in; Central's copy always reports 0. */
  versionCount?: number;
}

const CANDIDATES = 20;

/**
 * Neither API reports downloads, so: exact artifact-id matches first, then by how many versions the
 * artifact has published (a decent proxy for an established library), then in the order received.
 */
export function rankDocs(docs: Doc[], query: string): string[] {
  const term = query.trim().toLowerCase().replace(/\s+/g, '-');
  const artifactTerm = term.includes(':') ? term.split(':')[1] : term;
  const best = new Map<string, { exact: boolean; versions: number; order: number }>();
  docs.forEach((d, order) => {
    const name = `${d.g}:${d.a}`;
    const seen = best.get(name);
    const versions = Math.max(seen?.versions ?? 0, d.versionCount ?? 0);
    best.set(name, { exact: d.a.toLowerCase() === artifactTerm, versions, order: seen?.order ?? order });
  });
  return [...best.entries()]
    .sort(([, x], [, y]) => Number(y.exact) - Number(x.exact) || y.versions - x.versions || x.order - y.order)
    .map(([name]) => name);
}

async function searchDocs(url: string, signal: AbortSignal): Promise<Doc[]> {
  return (await getJson<{ response: { docs: Doc[] } }>(url, signal)).response.docs;
}

/** Central's copy of the search API rejects free text with spaces, so it gets an artifact-id prefix query. */
function centralQuery(query: string): string | undefined {
  const term = query.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._:-]/g, '');
  if (!term) {
    return undefined;
  }
  const [groupId, artifactId] = term.split(':');
  return artifactId !== undefined ? `g:${groupId} AND a:${artifactId}*` : `a:${term}*`;
}

function coordinates(p: PackageSpec): { groupId: string; artifactId: string } {
  const [groupId, artifactId] = p.name.split(':');
  return { groupId, artifactId };
}

export const mavenRegistry: Registry = {
  id: 'maven',
  label: 'Java',
  title: 'Java / Kotlin libraries from Maven Central',
  example: 'com.google.guava:guava, org.junit.jupiter:junit-jupiter',
  // Central's own search is flaky and poorly ranked; the index ranks by dependents. Its versions are stale.
  ecosystems: {
    registry: 'repo1.maven.org',
    ecosystem: 'maven',
    sort: 'dependent_packages_count',
    lastSegmentSeparator: ':',
    hideVersion: true,
    preferred: true,
  },
  projectMarkers: [{ file: 'pom.xml' }, { file: 'build.gradle' }, { file: 'build.gradle.kts' }, { file: 'settings.gradle.kts' }],
  namePattern: /^[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/,
  versionPattern: /^[0-9A-Za-z][0-9A-Za-z._+-]*$/,
  // Maven and Gradle have no "add dependency" command, so these are snippets for the build file.
  tools: [
    {
      id: 'maven',
      label: 'Maven',
      kind: 'snippet',
      markers: [{ file: 'pom.xml' }],
      build: (p) =>
        perPackage(p, (x) => {
          const { groupId, artifactId } = coordinates(x);
          return [
            '<dependency>',
            `  <groupId>${groupId}</groupId>`,
            `  <artifactId>${artifactId}</artifactId>`,
            `  <version>${x.version}</version>`,
            '</dependency>',
          ].join('\n');
        }),
    },
    {
      id: 'gradle-kotlin',
      label: 'Gradle (Kotlin)',
      kind: 'snippet',
      markers: [{ file: 'build.gradle.kts' }, { file: 'settings.gradle.kts' }],
      build: (p) => perPackage(p, (x) => `implementation("${x.name}:${x.version}")`),
    },
    {
      id: 'gradle-groovy',
      label: 'Gradle (Groovy)',
      kind: 'snippet',
      markers: [{ file: 'build.gradle' }, { file: 'settings.gradle' }],
      build: (p) => perPackage(p, (x) => `implementation '${x.name}:${x.version}'`),
    },
  ],

  pageUrl: (name) => {
    const { groupId, artifactId } = coordinates({ name, version: '' });
    return `https://central.sonatype.com/artifact/${groupId}/${artifactId}`;
  },

  async search(query, limit, signal) {
    // Search only finds coordinates; its "latestVersion" lags by months, so versions come from metadata.
    // search.maven.org ranks best but often hangs, so Central's copy runs in parallel as the fallback.
    const q = centralQuery(query);
    const central = q
      ? searchDocs(`${CENTRAL_SEARCH}?q=${encodeURIComponent(q)}&rows=${CANDIDATES}&wt=json`, signal)
      : Promise.resolve([]);
    central.catch(() => undefined);
    const legacy = await searchDocs(
      `${LEGACY_SEARCH}?q=${encodeURIComponent(query)}&rows=${CANDIDATES}&wt=json`,
      AbortSignal.any([signal, AbortSignal.timeout(LEGACY_BUDGET_MS)]),
    ).catch(() => []);
    const fallback = await central.catch((e) => {
      if (legacy.length) {
        return [];
      }
      throw e;
    });
    return rankDocs([...fallback, ...legacy], query)
      .slice(0, limit)
      .map((name) => ({ registry: 'maven', name, version: '', description: '' }));
  },

  async versions(name, signal) {
    const { groupId, artifactId } = coordinates({ name, version: '' });
    const xml = await getText(
      `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`,
      signal,
    );
    const block = /<versions>([\s\S]*?)<\/versions>/.exec(xml)?.[1] ?? '';
    const published = [...block.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((m) => m[1]);
    const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(xml)?.[1];
    // Metadata lists versions in publish order, oldest first.
    return versionList(published.reverse(), release, isPrerelease);
  },
};
