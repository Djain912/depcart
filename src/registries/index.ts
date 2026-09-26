import { cratesRegistry } from './crates';
import { goRegistry } from './go';
import { hexRegistry } from './hex';
import { mavenRegistry } from './maven';
import { npmRegistry } from './npm';
import { nugetRegistry } from './nuget';
import { packagistRegistry } from './packagist';
import { pubRegistry } from './pub';
import { pypiRegistry } from './pypi';
import { rubygemsRegistry } from './rubygems';
import type { Registry } from './types';

/** Display order for search chips, results and command blocks. */
export const registries: Registry[] = [
  npmRegistry,
  pypiRegistry,
  goRegistry,
  cratesRegistry,
  mavenRegistry,
  nugetRegistry,
  rubygemsRegistry,
  packagistRegistry,
  pubRegistry,
  hexRegistry,
];

export function registryFor(id: string): Registry | undefined {
  return registries.find((r) => r.id === id);
}
