// Registries ask API clients to identify themselves with a way to reach the maintainer (crates.io requires it).
const USER_AGENT = 'depcart-vscode (+https://github.com/djain912/depcart)';

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

export async function request(url: string, signal: AbortSignal, headers: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, signal, headers: { 'User-Agent': USER_AGENT, ...headers } });
  if (!res.ok) {
    throw new HttpError(res.status, url);
  }
  return res;
}

export async function getJson<T>(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<T> {
  return (await request(url, signal, headers)).json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await request(url, signal, { 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

export async function getText(url: string, signal: AbortSignal): Promise<string> {
  return (await request(url, signal)).text();
}
