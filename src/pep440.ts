// Python version ordering (PEP 440): 1.0.dev1 < 1.0a1 < 1.0b2 < 1.0rc1 < 1.0 < 1.0.post1.
const PEP440 =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

const PHASE: Record<string, number> = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };

interface Key {
  epoch: number;
  release: number[];
  pre?: [number, number];
  post?: number;
  dev?: number;
}

function parse(version: string): Key | undefined {
  const m = PEP440.exec(version.trim());
  if (!m) {
    return undefined;
  }
  const release = m[2].split('.').map(Number);
  while (release.length > 1 && release[release.length - 1] === 0) {
    release.pop();
  }
  const postNumber = m[5] ?? m[6];
  return {
    epoch: Number(m[1] ?? 0),
    release,
    pre: m[3] ? [PHASE[m[3].toLowerCase()], Number(m[4] || 0)] : undefined,
    post: postNumber !== undefined ? Number(postNumber || 0) : undefined,
    dev: m[7] !== undefined ? Number(m[7] || 0) : undefined,
  };
}

function compareArrays(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** A dev release of a final version sorts before its pre-releases; a final version after them. */
function preRank(k: Key): number[] {
  if (k.pre) {
    return k.pre;
  }
  return k.dev !== undefined && k.post === undefined ? [-1, 0] : [3, 0];
}

export function comparePep440(a: string, b: string): number {
  const ka = parse(a);
  const kb = parse(b);
  if (!ka || !kb) {
    return ka ? 1 : kb ? -1 : a.localeCompare(b);
  }
  return (
    ka.epoch - kb.epoch ||
    compareArrays(ka.release, kb.release) ||
    compareArrays(preRank(ka), preRank(kb)) ||
    (ka.post ?? -1) - (kb.post ?? -1) ||
    (ka.dev ?? Infinity) - (kb.dev ?? Infinity) ||
    0
  );
}

export function isPep440Prerelease(version: string): boolean {
  const k = parse(version);
  return !!k && (k.pre !== undefined || k.dev !== undefined);
}
