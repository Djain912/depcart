import { ecosystemsSearch } from './registries/ecosystems';
import type { PackageSummary, Registry } from './registries/types';

export interface Timing {
  /** Hard limit for one source. */
  stepMs: number;
  /** How long the first source gets before the second one is started alongside it. */
  hedgeMs: number;
}

export const DEFAULT_TIMING: Timing = { stepMs: 8000, hedgeMs: 2500 };

export type Source = (signal: AbortSignal) => Promise<PackageSummary[]>;

type Outcome = { results: PackageSummary[] } | { error: unknown };

/** Settles within `ms` even when the work ignores its abort signal (e.g. a shared background download). */
export function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
  const step = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.aborted ? signal.reason : new Error(`no answer within ${Math.round(ms / 1000)}s`));
    if (step.aborted) {
      onAbort();
      return;
    }
    step.addEventListener('abort', onAbort, { once: true });
    work(step)
      .then(resolve, reject)
      .finally(() => step.removeEventListener('abort', onAbort));
  });
}

const delay = (ms: number) => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));

/**
 * Results from the first source, unless it is slow, fails or finds nothing: then the second source
 * runs too and the first non-empty answer wins. Throws only when every source failed.
 */
export async function firstNonEmpty(sources: [Source, Source], signal: AbortSignal, timing: Timing = DEFAULT_TIMING): Promise<PackageSummary[]> {
  const attempt = (source: Source): Promise<Outcome> =>
    withDeadline(source, signal, timing.stepMs).then(
      (results) => ({ results }),
      (error) => ({ error }),
    );
  const first = attempt(sources[0]);
  const early = await Promise.race([first, delay(timing.hedgeMs)]);
  if (early && 'results' in early && early.results.length) {
    return early.results;
  }
  if (signal.aborted) {
    throw signal.reason;
  }
  const runs = [first, attempt(sources[1])];
  const outcomes = await new Promise<Outcome[]>((resolve) => {
    const done: Outcome[] = [];
    for (const run of runs) {
      void run.then((outcome) => {
        done.push(outcome);
        if (('results' in outcome && outcome.results.length) || done.length === runs.length) {
          resolve(done);
        }
      });
    }
  });
  const winner = outcomes.find((o): o is { results: PackageSummary[] } => 'results' in o && o.results.length > 0);
  if (winner) {
    return winner.results;
  }
  if (signal.aborted) {
    throw signal.reason;
  }
  const errors = outcomes.filter((o): o is { error: unknown } => 'error' in o);
  if (errors.length === outcomes.length) {
    throw errors[0].error;
  }
  return [];
}

/** The registry's own search plus the ecosyste.ms index, in the order the registry prefers. */
export function searchRegistry(
  registry: Registry,
  query: string,
  limit: number,
  signal: AbortSignal,
  timing: Timing = DEFAULT_TIMING,
): Promise<PackageSummary[]> {
  const native: Source = (s) => registry.search(query, limit, s);
  const index: Source = (s) => ecosystemsSearch(registry, query, limit, s);
  return firstNonEmpty(registry.ecosystems.preferred ? [index, native] : [native, index], signal, timing);
}

/**
 * Keeps only suggested names that really exist on their registry (an AI model can invent names,
 * and invented names are exactly what typosquatters register).
 */
export async function verifySuggestions(
  registries: Registry[],
  suggestions: Record<string, string[]>,
  signal: AbortSignal,
  stepMs = DEFAULT_TIMING.stepMs,
): Promise<PackageSummary[]> {
  const checks = registries.flatMap((registry) =>
    (suggestions[registry.id] ?? []).map(async (name): Promise<PackageSummary[]> => {
      try {
        const list = await withDeadline((s) => registry.versions(name, s), signal, stepMs);
        return list.versions.length
          ? [
              {
                registry: registry.id,
                name,
                version: list.latest,
                description: 'Suggested by AI and found on the registry. Make sure it is the package you expect.',
                via: 'ai',
              },
            ]
          : [];
      } catch {
        return [];
      }
    }),
  );
  return (await Promise.all(checks)).flat();
}
