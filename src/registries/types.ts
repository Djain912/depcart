export interface PackageSummary {
  registry: string;
  name: string;
  /** Empty when the registry's search doesn't report a (trustworthy) version. */
  version: string;
  description: string;
  /** Set when the result didn't come from the registry's own search. */
  via?: 'ecosyste.ms' | 'ai';
}

/** How to search this registry through the ecosyste.ms package index (used as a second source). */
export interface EcosystemsConfig {
  /** Registry name on ecosyste.ms, e.g. "npmjs.org". */
  registry: string;
  /** Ecosystem name for bulk lookups, e.g. "npm". */
  ecosystem: string;
  /** Popularity signal; registries without download stats rank by dependents instead. */
  sort: 'downloads' | 'dependent_packages_count';
  /** Also match names whose last segment is the query, e.g. "/" for Go ("github.com/gin-gonic/gin"). */
  lastSegmentSeparator?: string;
  /** Don't show the index's latest version in results (it's stale for some registries). */
  hideVersion?: boolean;
  /** Search the index before the registry's own search (when the index ranks better). */
  preferred?: boolean;
}

export interface VersionList {
  /** Newest first. */
  versions: string[];
  /** The subset of `versions` that are pre-releases. */
  prereleases: string[];
  latest: string;
}

export interface PackageSpec {
  name: string;
  version: string;
}

export interface Marker {
  /** A file in the project root; "*.ext" matches any file with that extension. */
  file: string;
  /** When set, the file only counts if its content matches. */
  contains?: RegExp;
}

export interface InstallTool {
  id: string;
  label: string;
  /** A snippet is pasted into a build file instead of being run in a terminal. */
  kind: 'command' | 'snippet';
  /** Project files that show this tool is the one in use. */
  markers?: Marker[];
  /** Commands only: the program the command starts with, and where to get it when it isn't installed. */
  needs?: ProgramNeed;
  build(packages: PackageSpec[]): string;
}

export interface ProgramNeed {
  program: string;
  /** Other names the same program goes by (e.g. pip3); the command is rewritten to use the one found. */
  alternatives?: string[];
  /** What to install, e.g. "Node.js" for npm. */
  installName: string;
  installUrl: string;
}

export interface Registry {
  id: string;
  /** Short name used for chips, badges and command block titles. */
  label: string;
  /** Tooltip, e.g. "Python packages from PyPI". */
  title: string;
  /** Example package names, showing their shape (used when asking an AI model for suggestions). */
  example: string;
  ecosystems: EcosystemsConfig;
  /** Project files that show the workspace uses this ecosystem. */
  projectMarkers: Marker[];
  namePattern: RegExp;
  versionPattern: RegExp;
  /** The first tool is the default when nothing is detected. */
  tools: InstallTool[];
  /** The package's page on the official registry website (name must already be validated). */
  pageUrl(name: string): string;
  search(query: string, limit: number, signal: AbortSignal): Promise<PackageSummary[]>;
  versions(name: string, signal: AbortSignal): Promise<VersionList>;
}
