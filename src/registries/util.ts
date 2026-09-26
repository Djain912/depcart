import type { PackageSpec, VersionList } from './types';

/** "name<sep>version" for every package, space separated, for tools that take many packages at once. */
export function specs(packages: PackageSpec[], separator: string): string {
  return packages.map((p) => `${p.name}${separator}${p.version}`).join(' ');
}

/** One line per package, for tools that only accept a single package per invocation. */
export function perPackage(packages: PackageSpec[], line: (p: PackageSpec) => string): string {
  return packages.map(line).join('\n');
}

export function versionList(newestFirst: string[], latest: string | undefined, isPrerelease: (v: string) => boolean): VersionList {
  const versions = [...new Set(newestFirst)];
  const prereleases = versions.filter(isPrerelease);
  return {
    versions,
    prereleases,
    latest: latest && versions.includes(latest) ? latest : versions.find((v) => !isPrerelease(v)) ?? versions[0] ?? '',
  };
}

export function packageJsonManager(name: string) {
  return { file: 'package.json', contains: new RegExp(`"packageManager"\\s*:\\s*"${name}@`) };
}
