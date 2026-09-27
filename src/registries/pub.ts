import { isPrerelease, sortNewestFirst } from '../semver';
import { getJson } from './http';
import type { Registry } from './types';
import { specs, versionList } from './util';

const API = 'https://pub.dev/api';

export const pubRegistry: Registry = {
  id: 'pub',
  label: 'Dart',
  title: 'Dart / Flutter packages from pub.dev',
  example: 'http, provider',
  ecosystems: { registry: 'pub.dev', ecosystem: 'pub', sort: 'dependent_packages_count' },
  projectMarkers: [{ file: 'pubspec.yaml' }],
  namePattern: /^[a-z_][a-z0-9_]*$/,
  versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  tools: [
    {
      id: 'dart',
      label: 'dart pub',
      kind: 'command',
      needs: { program: 'dart', installName: 'the Dart SDK', installUrl: 'https://dart.dev/get-dart' },
      build: (p) => `dart pub add ${specs(p, ':')}`,
    },
    {
      id: 'flutter',
      label: 'flutter pub',
      kind: 'command',
      markers: [{ file: 'pubspec.yaml', contains: /sdk:\s*flutter/ }],
      needs: { program: 'flutter', installName: 'Flutter', installUrl: 'https://docs.flutter.dev/install' },
      build: (p) => `flutter pub add ${specs(p, ':')}`,
    },
  ],

  pageUrl: (name) => `https://pub.dev/packages/${name}`,

  async search(query, limit, signal) {
    // pub.dev search returns names only.
    const data = await getJson<{ packages: { package: string }[] }>(`${API}/search?q=${encodeURIComponent(query)}`, signal);
    return data.packages.slice(0, limit).map((p) => ({ registry: 'pub', name: p.package, version: '', description: '' }));
  },

  async versions(name, signal) {
    const data = await getJson<{ latest: { version: string }; versions: { version: string; retracted?: boolean }[] }>(
      `${API}/packages/${name}`,
      signal,
    );
    const available = data.versions.filter((v) => !v.retracted).map((v) => v.version);
    return versionList(sortNewestFirst(available), data.latest.version, isPrerelease);
  },
};
