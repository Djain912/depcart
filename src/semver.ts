const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

function parse(version: string): Parsed | undefined {
  const m = SEMVER.exec(version);
  if (!m) {
    return undefined;
  }
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver ordering; works for npm versions and Go's v-prefixed (including pseudo-) versions. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    return pa ? 1 : pb ? -1 : a.localeCompare(b);
  }
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) {
      return pa.core[i] - pb.core[i];
    }
  }
  if (!pa.pre.length || !pb.pre.length) {
    return pb.pre.length - pa.pre.length;
  }
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === y) {
      continue;
    }
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      return Number(x) - Number(y);
    }
    if (xNum !== yNum) {
      return xNum ? -1 : 1;
    }
    return x < y ? -1 : 1;
  }
  return pa.pre.length - pb.pre.length;
}

export function sortNewestFirst(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

export function isPrerelease(version: string): boolean {
  return (parse(version)?.pre.length ?? 0) > 0;
}
