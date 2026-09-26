import type { Registry } from './registries/types';

// Names and versions end up in shell commands and build files. On top of each registry's own
// pattern, only characters that are inert in bash, zsh, PowerShell and cmd are allowed, and
// nothing may start with "-" (flag injection).
const SHELL_SAFE = /^[A-Za-z0-9@_][A-Za-z0-9@._~+:/-]*$/;
const MAX_LENGTH = 214;

function safe(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LENGTH && SHELL_SAFE.test(value);
}

export function isValidName(registry: Registry | undefined, name: unknown): boolean {
  return !!registry && safe(name) && registry.namePattern.test(name);
}

export function isValidVersion(registry: Registry | undefined, version: unknown): boolean {
  return !!registry && safe(version) && registry.versionPattern.test(version);
}
