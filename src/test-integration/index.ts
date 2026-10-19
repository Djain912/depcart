// Runs inside a real VS Code extension host (see scripts/test-host.js): real network stack, real
// workspace, terminal, clipboard and language-model APIs. It plays the webview's side of the message
// protocol against the real provider and records every check in a JSON report.
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PickerViewProvider } from '../pickerViewProvider';
import { registries, registryFor } from '../registries';
import { isOnPath } from '../toolCheck';
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

/** Everything, end to end, in a trusted folder. */
async function trustedChecks(): Promise<void> {
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

  await check('feedback is one click away: sidebar link and toolbar command', async () => {
    const html = host.view.webview.html;
    assert(html.includes('id="feedback"'), 'no Feedback link in the sidebar credit bar');
    const commands = await vscode.commands.getCommands(true);
    assert(commands.includes('depcart.feedback'), 'depcart.feedback command is not registered');
    const menus = ext?.packageJSON?.contributes?.menus?.['view/title'] ?? [];
    assert(menus.some((m: Message) => m.command === 'depcart.feedback'), 'no Feedback button in the view title bar');
    return 'Feedback link in the credit bar, "DepCart: Send Feedback or Request a Feature" command, toolbar button';
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
  let commandBlocks: Message[] = [];
  await check('one command block per language, tools detected from project files', async () => {
    const from = host.mark();
    host.send({ type: 'selection', items: selection });
    const msg = await host.waitFor(from, (m) => m.type === 'commands', 10000, 'commands');
    assert(msg.rejected.length === 0, `rejected: ${JSON.stringify(msg.rejected)}`);
    assert(msg.blocks.length === selection.length, `expected ${selection.length} blocks, got ${msg.blocks.length}`);
    const wrongTools = msg.blocks.filter((b: Message) => b.tool !== EXPECTED_TOOLS[b.registry]).map((b: Message) => `${b.registry}=${b.tool}`);
    assert(wrongTools.length === 0, `unexpected tools: ${wrongTools.join(', ')}`);
    npmCommand = msg.blocks.find((b: Message) => b.registry === 'npm')?.command ?? '';
    commandBlocks = msg.blocks;
    return msg.blocks.map((b: Message) => `${b.tool}: ${b.command.split('\n')[0]}`).join(' | ');
  });

  await check('tools that are not installed are flagged, with an install guide, before Run in terminal', async () => {
    const report: string[] = [];
    for (const b of commandBlocks.filter((x: Message) => x.kind === 'command')) {
      const needs = registryFor(b.registry)?.tools.find((t) => t.id === b.tool)?.needs;
      assert(needs, `${b.tool} has no program to check`);
      const program = b.command.split(' ')[0];
      const onPath = await isOnPath(program);
      assert(onPath === !b.missing, `${program}: on PATH=${onPath} but flagged missing=${!!b.missing}`);
      if (b.missing) {
        assert(b.missing.program === needs.program && b.missing.installName === needs.installName, `bad notice for ${b.tool}`);
        assert(!b.missing.alternative, `${b.tool} comes from the project's files, so no other tool should be offered`);
      }
      report.push(`${program} ${onPath ? 'found' : 'missing, install guide shown'}`);
    }
    assert(!commandBlocks.find((b: Message) => b.registry === 'npm')?.missing, 'npm is flagged although the tests run on Node');
    return report.join(', ');
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

  await check('Run in terminal really installs the package (npm, in the throwaway test project)', async () => {
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

  await check('package health for every registry: downloads or dependents, last release, last commit', async () => {
    const items = registries.filter((r) => top[r.id]).map((r) => ({ registry: r.id, name: top[r.id] }));
    assert(items.length === registries.length, `only ${items.length} registries had a search result to look up`);
    const from = host.mark();
    host.send({ type: 'health', items });
    const answers = await Promise.all(
      items.map((item) => host.waitFor(from, (m) => m.type === 'health' && m.registry === item.registry, 30000, `${item.registry} health`)),
    );
    const report: string[] = [];
    const problems: string[] = [];
    for (const [i, answer] of answers.entries()) {
      const { registry, name } = items[i];
      const health = answer.health[name];
      if (answer.failed.length || !health) {
        problems.push(`${registry} ${name}: ${answer.failed.length ? 'lookup failed' : 'no data'}`);
        continue;
      }
      const popularity = health.downloads ?? health.dependents;
      if (!(popularity > 0)) {
        problems.push(`${registry} ${name}: no downloads or dependents`);
      }
      for (const field of ['released', 'committed'] as const) {
        if (health[field] !== undefined && Number.isNaN(Date.parse(health[field]))) {
          problems.push(`${registry} ${name}: ${field} "${health[field]}" is not a date`);
        }
      }
      if (registry === 'maven' && health.released) {
        problems.push('maven shows the index release date, which is stale');
      }
      const lag = health.releasedVersion && latest[registry] && health.releasedVersion !== latest[registry] ? ` (registry latest ${latest[registry]})` : '';
      report.push(
        `${registryFor(registry)?.label} ${name}: ${popularity} ${health.downloads !== undefined ? `downloads/${health.downloadsPeriod}` : 'dependents'}` +
          `${health.released ? `, ${health.releasedVersion} on ${health.released.slice(0, 10)}${lag}` : ''}` +
          `${health.committed ? `, push ${health.committed.slice(0, 10)}` : ''}${health.deprecated ? ', DEPRECATED' : ''}${health.archived ? ', ARCHIVED' : ''}`,
      );
    }
    assert(problems.length === 0, problems.join('; '));
    return report.join(' | ');
  });

  await check('health for a deprecated, archived package is flagged (npm request)', async () => {
    const from = host.mark();
    host.send({ type: 'health', items: [{ registry: 'npm', name: 'request' }] });
    const msg = await host.waitFor(from, (m) => m.type === 'health' && m.registry === 'npm' && 'request' in m.health, 30000, 'health');
    const health = msg.health.request;
    assert(health?.deprecated === true, `request is deprecated on npm, got ${JSON.stringify(health)}`);
    return `deprecated: ${health.deprecated}, last release ${health.released?.slice(0, 10)}`;
  });

  await check('unsafe names in a health request are answered, never looked up', async () => {
    const from = host.mark();
    host.send({ type: 'health', items: [{ registry: 'npm', name: '--version; rm -rf /' }, { registry: 'nope', name: 'x' }] });
    const msg = await host.waitFor(from, (m) => m.type === 'health' && m.registry === 'npm', 10000, 'health');
    assert(msg.health['--version; rm -rf /'] === null, 'the unsafe name did not get a null answer');
    return 'unsafe name answered with null; unknown registry ignored';
  });

  await check('"DepCart: Search Packages" opens the sidebar', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert(commands.includes('depcart.search'), 'depcart.search command is not registered');
    await vscode.commands.executeCommand('depcart.search');
    return 'command registered and runs';
  });

  await check('manifest: DepCart runs in Restricted Mode (limited), so its activity bar icon always shows', async () => {
    const trust = ext?.packageJSON?.capabilities?.untrustedWorkspaces;
    assert(trust?.supported === 'limited', `untrustedWorkspaces.supported is ${JSON.stringify(trust?.supported)}`);
    assert(trust.restrictedConfigurations?.includes('depcart.aiFallback'), 'depcart.aiFallback is not a restricted setting');
    return trust.description;
  });
}

/** In Restricted Mode DepCart must still show up and search, but never run anything in the folder. */
async function restrictedChecks(): Promise<void> {
  const workspace = process.env.DEPCART_TEST_WORKSPACE ?? '';
  const ext = vscode.extensions.getExtension('djain912.depcart');

  await check('the test window really is in Restricted Mode', async () => {
    assert(!vscode.workspace.isTrusted, 'the workspace is trusted, so this run proves nothing');
    return `workspace.isTrusted = ${vscode.workspace.isTrusted}`;
  });

  await check('DepCart, installed from the .vsix, is enabled and activates in Restricted Mode', async () => {
    assert(ext, 'djain912.depcart is not available: VS Code disabled it in Restricted Mode, so its activity bar icon is gone');
    const installedIn = process.env.DEPCART_TEST_EXTENSIONS_DIR;
    assert(installedIn && path.resolve(ext.extensionPath).startsWith(path.resolve(installedIn)), `not the installed copy: ${ext.extensionPath}`);
    await ext.activate();
    assert(ext.isActive, 'extension did not activate');
    return `installed ${ext.packageJSON.version} at ${path.basename(ext.extensionPath)}`;
  });

  await check('its sidebar opens from the activity bar in Restricted Mode', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.depcart');
    await vscode.commands.executeCommand('depcart.search');
  });

  await check('the workspace value of depcart.aiFallback is ignored in Restricted Mode', async () => {
    const value = vscode.workspace.getConfiguration('depcart').get<boolean>('aiFallback');
    assert(value === true, `got ${value}: the untrusted folder's .vscode/settings.json was applied`);
    return 'folder sets false, DepCart reads the user value (true)';
  });

  const host = fakeWebviewView();
  new PickerViewProvider(ext?.extensionUri ?? vscode.Uri.file(path.resolve(__dirname, '..', '..')), memento()).resolveWebviewView(host.view);

  await check('search works in Restricted Mode', async () => {
    const from = host.mark();
    host.send({ type: 'search', query: 'zod', registries: ['npm'], requestId: 1 });
    const msg = await host.waitFor(from, (m) => m.type === 'searchResults' && m.requestId === 1, 30000, 'search results');
    assert(!msg.error, `error: ${msg.error}`);
    assert(msg.results.some((r: Message) => r.name === 'zod'), 'zod not found');
    return `${msg.results.length} results`;
  });

  let command = '';
  await check('install commands are built (and marked Restricted Mode)', async () => {
    const from = host.mark();
    host.send({ type: 'selection', items: [{ registry: 'npm', name: 'zod', version: '3.23.8' }] });
    const msg = await host.waitFor(from, (m) => m.type === 'commands', 10000, 'commands');
    command = msg.blocks[0]?.command ?? '';
    assert(command === 'npm install zod@3.23.8', `got: ${command}`);
    assert(msg.trusted === false, `trusted flag is ${msg.trusted}`);
    return command;
  });

  await check('Copy works in Restricted Mode', async () => {
    const saved = await vscode.env.clipboard.readText();
    try {
      host.send({ type: 'copy', registry: 'npm' });
      const deadline = Date.now() + 5000;
      let text = '';
      while (Date.now() < deadline && text !== command) {
        await new Promise((r) => setTimeout(r, 100));
        text = await vscode.env.clipboard.readText();
      }
      assert(text === command, `clipboard has "${text}"`);
      return text;
    } finally {
      await vscode.env.clipboard.writeText(saved);
    }
  });

  await check('Run in terminal runs nothing in Restricted Mode', async () => {
    const before = vscode.window.terminals.length;
    host.send({ type: 'run', registry: 'npm' });
    await new Promise((r) => setTimeout(r, 4000));
    assert(!vscode.window.terminals.some((t) => t.name.startsWith('DepCart:')), 'a DepCart terminal was opened');
    assert(vscode.window.terminals.length === before, 'a terminal was opened');
    assert(!existsSync(path.join(workspace, 'node_modules')), 'node_modules appeared: something was installed');
    return 'no terminal opened, nothing installed; the user is offered "Manage Workspace Trust" instead';
  });
}

export async function run(): Promise<void> {
  await (process.env.DEPCART_TEST_MODE === 'restricted' ? restrictedChecks() : trustedChecks());
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
