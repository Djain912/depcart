// Runs inside a real VS Code extension host (see scripts/test-host.js): real network stack, real
// workspace, terminal, clipboard and language-model APIs. It plays the webview's side of the message
// protocol against the real provider and records every check in a JSON report.
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PickerViewProvider } from '../pickerViewProvider';
import { registries, registryFor } from '../registries';
import { isValidVersion } from '../validation';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}

type Message = Record<string, any>;

const checks: Check[] = [];

async function check(name: string, body: () => Promise<string | void>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await body();
    checks.push({ name, ok: true, detail: detail || undefined, ms: Date.now() - started });
  } catch (e) {
    checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** A stand-in for the webview: records what the provider posts and lets the test send messages. */
function fakeWebviewView() {
  const received: Message[] = [];
  const waiters: { from: number; match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  let handler: (msg: Message) => unknown = () => undefined;
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview:',
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: (cb: (msg: Message) => unknown) => {
      handler = cb;
      return { dispose() {} };
    },
    postMessage: async (msg: Message) => {
      received.push(msg);
      for (const w of [...waiters]) {
        if (w.match(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
      return true;
    },
  };
  return {
    view: { webview } as unknown as vscode.WebviewView,
    mark: () => received.length,
    send: (msg: Message) => handler(msg),
    /** The first message at or after `from` that matches, waiting up to `ms`. */
    waitFor(from: number, match: (m: Message) => boolean, ms: number, what: string): Promise<Message> {
      const already = received.slice(from).find(match);
      if (already) {
        return Promise.resolve(already);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${what} within ${ms / 1000}s`)), ms);
        waiters.push({ from, match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
  };
}

function memento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void store.set(key, value),
  } as vscode.Memento;
}

const SEARCHES: [registry: string, query: string, expected: string][] = [
  ['npm', 'zod', 'zod'],
  ['npm', 'react', 'react'],
  ['pypi', 'requests', 'requests'],
  ['pypi', 'fastapi', 'fastapi'],
  ['go', 'gin', 'github.com/gin-gonic/gin'],
  ['go', 'cobra', 'github.com/spf13/cobra'],
  ['crates', 'serde', 'serde'],
  ['crates', 'tokio', 'tokio'],
  ['maven', 'guava', 'com.google.guava:guava'],
  ['maven', 'jackson-databind', 'com.fasterxml.jackson.core:jackson-databind'],
  ['nuget', 'newtonsoft', 'Newtonsoft.Json'],
  ['nuget', 'serilog', 'Serilog'],
  ['rubygems', 'rails', 'rails'],
  ['rubygems', 'devise', 'devise'],
  ['packagist', 'monolog', 'monolog/monolog'],
  ['packagist', 'guzzle', 'guzzlehttp/guzzle'],
  ['pub', 'http', 'http'],
  ['pub', 'provider', 'provider'],
  ['hex', 'phoenix', 'phoenix'],
  ['hex', 'jason', 'jason'],
];

const EXPECTED_TOOLS: Record<string, string> = {
  npm: 'npm',
  pypi: 'poetry',
  go: 'go',
  crates: 'cargo',
  maven: 'maven',
  nuget: 'dotnet',
  rubygems: 'bundler',
  packagist: 'composer',
  pub: 'flutter',
  hex: 'mix',
};

export async function run(): Promise<void> {
  const workspace = process.env.DEPCART_TEST_WORKSPACE ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const ext = vscode.extensions.getExtension('djain912.depcart');

  await check('extension is installed and activates in the host', async () => {
    assert(ext, 'extension djain912.depcart not found');
    await ext.activate();
    assert(ext.isActive, 'extension did not activate');
  });

  await check('DepCart sidebar opens (activity bar view container)', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.depcart');
  });

  const host = fakeWebviewView();
  const extensionUri = ext?.extensionUri ?? vscode.Uri.file(path.resolve(__dirname, '..', '..'));
  new PickerViewProvider(extensionUri, memento()).resolveWebviewView(host.view);
  let requestId = 1000;

  let aiAvailable = false;
  await check('webview handshake: registries, detected ecosystems, AI availability', async () => {
    const from = host.mark();
    host.send({ type: 'ready' });
    const init = await host.waitFor(from, (m) => m.type === 'init', 10000, 'init message');
    assert(init.registries.length === registries.length, `expected ${registries.length} registries, got ${init.registries.length}`);
    const missing = registries.map((r) => r.id).filter((id) => !init.detected.includes(id));
    assert(missing.length === 0, `not detected from the test project: ${missing.join(', ')}`);
    aiAvailable = init.ai;
    return `detected all ${init.detected.length} ecosystems; AI model available: ${init.ai}`;
  });

  const top: Record<string, string> = {};
  for (const [registry, query, expected] of SEARCHES) {
    await check(`search ${registryFor(registry)?.label} for "${query}" finds ${expected}`, async () => {
      const id = ++requestId;
      const from = host.mark();
      host.send({ type: 'search', query, registries: [registry], requestId: id });
      const msg = await host.waitFor(from, (m) => m.type === 'searchResults' && m.requestId === id && m.registry === registry, 30000, 'search results');
      assert(!msg.error, `error: ${msg.error}`);
      const names: string[] = msg.results.map((r: Message) => r.name);
      const rank = names.findIndex((n) => n.toLowerCase() === expected.toLowerCase());
      assert(rank !== -1 && rank < 5, `"${expected}" not in the top 5: ${names.slice(0, 5).join(', ') || '(no results)'}`);
      top[registry] ??= names[rank];
      const via = [...new Set(msg.results.map((r: Message) => r.via ?? 'registry'))].join('+');
      return `#${rank + 1} of ${names.length} via ${via}; top 3: ${names.slice(0, 3).join(', ')}`;
    });
  }

  await check('"zod" across all ten registries at once: every registry answers', async () => {
    const id = ++requestId;
    const from = host.mark();
    host.send({ type: 'search', query: 'zod', registries: registries.map((r) => r.id), requestId: id });
    const answers = await Promise.all(
      registries.map((r) =>
        host.waitFor(from, (m) => m.type === 'searchResults' && m.requestId === id && m.registry === r.id, 30000, `${r.label} answer`),
      ),
    );
    const errors = answers.filter((a) => a.error).map((a) => `${a.registry}: ${a.error}`);
    assert(errors.length === 0, errors.join('; '));
    return answers.map((a) => `${registryFor(a.registry)?.label} ${a.results.length}`).join(', ');
  });

  const latest: Record<string, string> = {};
  for (const registry of registries) {
    const name = top[registry.id];
    if (!name) {
      continue;
    }
    await check(`versions for ${registry.label} ${name}`, async () => {
      const from = host.mark();
      host.send({ type: 'versions', registry: registry.id, name });
      const msg = await host.waitFor(from, (m) => m.type === 'versions' && m.registry === registry.id && m.name === name, 30000, 'versions');
      assert(!msg.error, `error: ${msg.error}`);
      assert(msg.versions.length > 0, 'no versions');
      assert(isValidVersion(registry, msg.latest), `latest "${msg.latest}" is not a valid ${registry.label} version`);
      latest[registry.id] = msg.latest;
      return `${msg.versions.length} versions (${msg.prereleases.length} pre-release), latest ${msg.latest}`;
    });
  }

  const selection = registries.filter((r) => latest[r.id]).map((r) => ({ registry: r.id, name: top[r.id], version: latest[r.id] }));
  let npmCommand = '';
  await check('one command block per language, tools detected from project files', async () => {
    const from = host.mark();
    host.send({ type: 'selection', items: selection });
    const msg = await host.waitFor(from, (m) => m.type === 'commands', 10000, 'commands');
    assert(msg.rejected.length === 0, `rejected: ${JSON.stringify(msg.rejected)}`);
    assert(msg.blocks.length === selection.length, `expected ${selection.length} blocks, got ${msg.blocks.length}`);
    const wrongTools = msg.blocks.filter((b: Message) => b.tool !== EXPECTED_TOOLS[b.registry]).map((b: Message) => `${b.registry}=${b.tool}`);
    assert(wrongTools.length === 0, `unexpected tools: ${wrongTools.join(', ')}`);
    npmCommand = msg.blocks.find((b: Message) => b.registry === 'npm')?.command ?? '';
    return msg.blocks.map((b: Message) => `${b.tool}: ${b.command.split('\n')[0]}`).join(' | ');
  });

  await check('switching the npm tool to pnpm rewrites the command', async () => {
    const from = host.mark();
    host.send({ type: 'setTool', registry: 'npm', tool: 'pnpm' });
    const msg = await host.waitFor(from, (m) => m.type === 'commands', 10000, 'commands');
    const block = msg.blocks.find((b: Message) => b.registry === 'npm');
    assert(block?.command.startsWith('pnpm add '), `got: ${block?.command}`);
    const back = host.mark();
    host.send({ type: 'setTool', registry: 'npm', tool: 'npm' });
    await host.waitFor(back, (m) => m.type === 'commands', 10000, 'commands');
    return `${block.command} (${block.note})`;
  });

  await check('Copy puts the command on the system clipboard', async () => {
    const saved = await vscode.env.clipboard.readText();
    try {
      host.send({ type: 'copy', registry: 'npm' });
      const deadline = Date.now() + 5000;
      let text = '';
      while (Date.now() < deadline && text !== npmCommand) {
        await new Promise((r) => setTimeout(r, 100));
        text = await vscode.env.clipboard.readText();
      }
      assert(text === npmCommand, `clipboard has "${text}"`);
      return text;
    } finally {
      await vscode.env.clipboard.writeText(saved);
    }
  });

  await check('Run in terminal really installs the package (npm, in the test project)', async () => {
    const version = latest.npm;
    assert(version, 'no npm version to install');
    const from = host.mark();
    host.send({ type: 'selection', items: [{ registry: 'npm', name: 'zod', version }] });
    await host.waitFor(from, (m) => m.type === 'commands', 10000, 'commands');
    host.send({ type: 'run', registry: 'npm' });
    // npm unpacks node_modules first and saves package.json last, so wait for the saved dependency.
    const installed = path.join(workspace, 'node_modules', 'zod', 'package.json');
    const manifestPath = path.join(workspace, 'package.json');
    const savedDependency = async () => JSON.parse(await fs.readFile(manifestPath, 'utf8')).dependencies?.zod as string | undefined;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !(existsSync(installed) && (await savedDependency()))) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    const terminal = vscode.window.terminals.find((t) => t.name.startsWith('DepCart:'));
    assert(terminal, 'no DepCart terminal was opened');
    assert(existsSync(installed), 'node_modules/zod was not installed within 120s');
    const pkg = JSON.parse(await fs.readFile(installed, 'utf8'));
    const dependency = await savedDependency();
    terminal.dispose();
    assert(pkg.version === version, `installed zod ${pkg.version}, expected ${version}`);
    assert(dependency, 'package.json was not updated with the dependency');
    return `terminal "${terminal.name}" ran npm install; node_modules/zod is ${pkg.version}; package.json now has "zod": "${dependency}"`;
  });

  await check('AI fallback wiring', async () => {
    if (!aiAvailable) {
      return 'no language model in this isolated test profile (needs GitHub Copilot Chat signed in), so AI suggestions are off, as designed';
    }
    const id = ++requestId;
    const from = host.mark();
    host.send({ type: 'askAi', query: 'schema validation', registries: ['npm'], requestId: id });
    const msg = await host.waitFor(from, (m) => m.type === 'aiResults' && m.requestId === id, 60000, 'AI results');
    assert(!msg.error, `error: ${msg.error}`);
    return `verified AI suggestions: ${msg.results.map((r: Message) => r.name).join(', ') || '(none)'}`;
  });

  const report = process.env.DEPCART_TEST_REPORT;
  if (report) {
    await fs.writeFile(
      report,
      JSON.stringify({ environment: { vscode: vscode.version, node: process.version, platform: process.platform }, checks }, null, 2),
    );
  }
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    throw new Error(`${failed.length} host check(s) failed: ${failed.map((c) => c.name).join('; ')}`);
  }
}
