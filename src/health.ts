import { ecosystemsHealth } from './registries/ecosystems';
import type { PackageHealth, Registry } from './registries/types';

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 2000;

type Fetch = (registry: Registry, names: string[], signal: AbortSignal) => Promise<Record<string, PackageHealth | null>>;

/**
 * Package health from the ecosyste.ms index, remembered for half an hour so refining a search
 * doesn't look the same packages up again. Failed lookups aren't remembered.
 */
export class HealthLookup {
  private readonly cache = new Map<string, { health: PackageHealth | null; at: number }>();

  constructor(
    private readonly fetchHealth: Fetch = ecosystemsHealth,
    private readonly now: () => number = Date.now,
  ) {}

  async get(registry: Registry, names: string[], signal: AbortSignal): Promise<Record<string, PackageHealth | null>> {
    // No prototype, so a package named "__proto__" (valid on pub.dev) is just another key.
    const result: Record<string, PackageHealth | null> = Object.create(null);
    const missing: string[] = [];
    for (const name of new Set(names)) {
      const hit = this.cache.get(`${registry.id}:${name}`);
      if (hit && this.now() - hit.at < TTL_MS) {
        result[name] = hit.health;
      } else {
        missing.push(name);
      }
    }
    if (missing.length) {
      const found = await this.fetchHealth(registry, missing, signal);
      for (const name of missing) {
        result[name] = found[name] ?? null;
        this.remember(`${registry.id}:${name}`, result[name]);
      }
    }
    return result;
  }

  private remember(key: string, health: PackageHealth | null): void {
    this.cache.delete(key);
    this.cache.set(key, { health, at: this.now() });
    if (this.cache.size > MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
