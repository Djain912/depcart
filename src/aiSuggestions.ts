import type { Registry } from './registries/types';
import { isValidName } from './validation';

const PER_REGISTRY = 5;

export function buildSuggestionPrompt(registries: Registry[], query: string): string {
  return [
    'You help developers find packages to install.',
    `Search text: ${JSON.stringify(query)}`,
    `For each registry below, list up to ${PER_REGISTRY} real, published packages that best match the search text by name or by purpose, most relevant first.`,
    'Only include packages you are confident exist under exactly that name. Use an empty list when unsure.',
    ...registries.map((r) => `- "${r.id}": ${r.title}. Names look like: ${r.example}`),
    'Reply with only a JSON object mapping each registry id to an array of package names, for example {"npm": ["zod"]}.',
  ].join('\n');
}

/** Pulls the JSON object out of a model reply (which may be wrapped in prose or a code fence) and keeps valid names. */
export function parseSuggestions(text: string, registries: Registry[]): Record<string, string[]> {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) {
    return {};
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const registry of registries) {
    const names = (data as Record<string, unknown>)[registry.id];
    if (!Array.isArray(names)) {
      continue;
    }
    const valid = names
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter((n) => isValidName(registry, n));
    out[registry.id] = [...new Set(valid)].slice(0, PER_REGISTRY);
  }
  return out;
}
