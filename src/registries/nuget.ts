import { getJson } from './http';
import type { Registry } from './types';
import { perPackage, versionList } from './util';

const SERVICE_INDEX = 'https://api.nuget.org/v3/index.json';
const FLAT_CONTAINER = 'https://api.nuget.org/v3-flatcontainer';

let searchEndpoint: Promise<string> | undefined;

/** NuGet publishes its search URL in the service index rather than at a fixed address. */
function searchUrl(signal: AbortSignal): Promise<string> {
  searchEndpoint ??= getJson<{ resources: { '@id': string; '@type': string }[] }>(SERVICE_INDEX, signal)
    .then((index) => {
      const service = index.resources.find((r) => r['@type'].startsWith('SearchQueryService'));
      if (!service) {
        throw new Error('NuGet search service not found');
      }
      return service['@id'];
    })
    .catch((e) => {
      searchEndpoint = undefined;
      throw e;
    });
  return searchEndpoint;
}

/** Anything with a "-" label before build metadata; also covers 4-part versions like 1.2.3.4-beta. */
const isPrerelease = (v: string) => /^[^+]*-/.test(v);

export const nugetRegistry: Registry = {
  id: 'nuget',
  label: '.NET',
  title: '.NET packages from NuGet',
  example: 'Newtonsoft.Json, Serilog',
  ecosystems: { registry: 'nuget.org', ecosystem: 'nuget', sort: 'downloads' },
  projectMarkers: [{ file: '*.csproj' }, { file: '*.fsproj' }, { file: '*.vbproj' }, { file: '*.sln' }, { file: '*.slnx' }],
  namePattern: /^[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*$/,
  versionPattern: /^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  tools: [
    {
      id: 'dotnet',
      label: 'dotnet CLI',
      kind: 'command',
      needs: { program: 'dotnet', installName: 'the .NET SDK', installUrl: 'https://dotnet.microsoft.com/download' },
      build: (p) => perPackage(p, (x) => `dotnet add package ${x.name} --version ${x.version}`),
    },
    {
      id: 'paket',
      label: 'Paket',
      kind: 'command',
      markers: [{ file: 'paket.dependencies' }],
      needs: { program: 'paket', installName: 'Paket', installUrl: 'https://fsprojects.github.io/Paket/installation.html' },
      build: (p) => perPackage(p, (x) => `paket add ${x.name} --version ${x.version}`),
    },
    {
      id: 'packagereference',
      label: 'PackageReference',
      kind: 'snippet',
      build: (p) => perPackage(p, (x) => `<PackageReference Include="${x.name}" Version="${x.version}" />`),
    },
  ],

  pageUrl: (name) => `https://www.nuget.org/packages/${name}`,

  async search(query, limit, signal) {
    const base = await searchUrl(signal);
    const data = await getJson<{ data: { id: string; version: string; description?: string }[] }>(
      `${base}?q=${encodeURIComponent(query)}&take=${limit}&semVerLevel=2.0.0`,
      signal,
    );
    return data.data.map((d) => ({ registry: 'nuget', name: d.id, version: d.version, description: d.description ?? '' }));
  },

  async versions(name, signal) {
    const data = await getJson<{ versions: string[] }>(`${FLAT_CONTAINER}/${name.toLowerCase()}/index.json`, signal);
    return versionList([...data.versions].reverse(), undefined, isPrerelease);
  },
};
