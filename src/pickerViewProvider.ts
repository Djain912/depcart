import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { aiAvailable, suggestPackages } from './ai';
import { buildCommands, type CommandBlock, type Selection } from './commandBuilder';
import { detectEcosystems, detectTool, listProjectFiles } from './detect';
import { registries, registryFor } from './registries';
import type { Registry } from './registries/types';
import { searchRegistry, verifySuggestions } from './search';
import { isValidName } from './validation';

const DEVELOPER_URL = 'https://linkedin.com/in/darshanjain912';
const TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 45_000;
const AI_MIN_QUERY = 3;
const TOOL_CHOICES_KEY = 'depcart.toolChoices';

type FromWebview =
  | { type: 'ready' }
  | { type: 'search'; query: string; registries: string[]; requestId: number }
  | { type: 'askAi'; query: string; registries: string[]; requestId: number }
  | { type: 'versions'; registry: string; name: string }
  | { type: 'selection'; items: Selection[] }
  | { type: 'setTool'; registry: string; tool: string }
  | { type: 'copy'; registry: string }
  | { type: 'run'; registry: string }
  | { type: 'open'; registry: string; name: string }
  | { type: 'openDeveloper' };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function targetFolder(): vscode.WorkspaceFolder | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  return (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
}

export class PickerViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'depcart.picker';

  private view?: vscode.WebviewView;
  private selections: Selection[] = [];
  private blocks: CommandBlock[] = [];
  private folder?: vscode.WorkspaceFolder;
  private searchAbort?: AbortController;
  private refreshSeq = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceState: vscode.Memento,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg));
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        return this.init();
      case 'search':
        return this.search(msg.query, Array.isArray(msg.registries) ? msg.registries : [], msg.requestId);
      case 'askAi':
        return this.askAi(
          msg.query,
          registries.filter((r) => Array.isArray(msg.registries) && msg.registries.includes(r.id)),
          msg.requestId,
          this.searchAbort?.signal ?? new AbortController().signal,
          true,
        );
      case 'versions':
        return this.versions(msg.registry, msg.name);
      case 'selection':
        this.selections = Array.isArray(msg.items) ? msg.items : [];
        return this.refreshCommands();
      case 'setTool':
        return this.setTool(msg.registry, msg.tool);
      case 'copy': {
        const block = this.blocks.find((b) => b.registry === msg.registry);
        if (block) {
          await vscode.env.clipboard.writeText(block.command);
          vscode.window.setStatusBarMessage(`DepCart: ${block.kind === 'snippet' ? 'snippet' : 'install command'} copied`, 2500);
        }
        return;
      }
      case 'run':
        return this.run(msg.registry);
      case 'open': {
        // The URL is always built here from a validated name, never taken from the webview.
        const registry = registryFor(msg.registry);
        if (registry && isValidName(registry, msg.name)) {
          await vscode.env.openExternal(vscode.Uri.parse(registry.pageUrl(msg.name)));
        }
        return;
      }
      case 'openDeveloper':
        await vscode.env.openExternal(vscode.Uri.parse(DEVELOPER_URL));
        return;
    }
  }

  private async init(): Promise<void> {
    const folder = targetFolder();
    const dir = folder?.uri.fsPath;
    const detected = dir ? await detectEcosystems(dir, await listProjectFiles(dir), registries) : [];
    this.post({
      type: 'init',
      registries: registries.map((r) => ({
        id: r.id,
        label: r.label,
        title: r.title,
        site: new URL(r.pageUrl(r.example.split(',')[0].trim())).hostname.replace(/^www\./, ''),
        tools: r.tools.map((t) => ({ id: t.id, label: t.label })),
      })),
      detected,
      ai: await this.aiReady(),
    });
  }

  private async aiReady(): Promise<boolean> {
    if (!vscode.workspace.getConfiguration('depcart').get<boolean>('aiFallback', true)) {
      return false;
    }
    return aiAvailable().catch(() => false);
  }

  async refreshAiAvailability(): Promise<void> {
    this.post({ type: 'aiAvailability', available: await this.aiReady() });
  }

  /**
   * Each registry's results are posted as soon as they arrive, so one slow registry doesn't hold up
   * the rest. Registries that find nothing then get one batched AI request, when a model is available.
   */
  private async search(query: string, ids: string[], requestId: number): Promise<void> {
    this.searchAbort?.abort();
    const controller = new AbortController();
    this.searchAbort = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const targets = registries.filter((r) => ids.includes(r.id));
    const limit = targets.length === 1 ? 20 : 10;
    const empty = await Promise.all(
      targets.map(async (registry) => {
        try {
          const results = await searchRegistry(registry, query, limit, signal);
          if (!controller.signal.aborted) {
            this.post({ type: 'searchResults', requestId, registry: registry.id, results });
          }
          return results.length ? [] : [registry];
        } catch (e) {
          if (!controller.signal.aborted) {
            this.post({ type: 'searchResults', requestId, registry: registry.id, results: [], error: errorMessage(e) });
          }
          return [registry];
        }
      }),
    );
    const nothingFound = empty.flat();
    if (!controller.signal.aborted && nothingFound.length && query.trim().length >= AI_MIN_QUERY && (await this.aiReady())) {
      await this.askAi(query, nothingFound, requestId, controller.signal, false);
    }
  }

  /** Asks the editor's AI model for package names, then keeps only names that exist on the registry. */
  private async askAi(query: string, targets: Registry[], requestId: number, searchSignal: AbortSignal, requested: boolean): Promise<void> {
    if (!targets.length || !query.trim()) {
      return;
    }
    const signal = AbortSignal.any([searchSignal, AbortSignal.timeout(AI_TIMEOUT_MS)]);
    this.post({ type: 'aiStarted', requestId, registries: targets.map((r) => r.id) });
    try {
      const suggestions = await suggestPackages(targets, query.trim(), signal);
      const results = await verifySuggestions(targets, suggestions, signal);
      if (!searchSignal.aborted) {
        this.post({ type: 'aiResults', requestId, results, requested });
      }
    } catch (e) {
      if (!searchSignal.aborted) {
        this.post({ type: 'aiResults', requestId, results: [], requested, error: errorMessage(e) });
      }
    }
  }

  private async versions(registryId: string, name: string): Promise<void> {
    const registry = registryFor(registryId);
    if (!registry || !isValidName(registry, name)) {
      this.post({ type: 'versions', registry: registryId, name, error: 'Invalid package name' });
      return;
    }
    try {
      const list = await registry.versions(name, AbortSignal.timeout(TIMEOUT_MS));
      this.post(
        list.versions.length
          ? { type: 'versions', registry: registryId, name, ...list }
          : { type: 'versions', registry: registryId, name, error: 'no installable versions published' },
      );
    } catch (e) {
      this.post({ type: 'versions', registry: registryId, name, error: errorMessage(e) });
    }
  }

  private async setTool(registryId: string, toolId: string): Promise<void> {
    if (!registryFor(registryId)?.tools.some((t) => t.id === toolId)) {
      return;
    }
    const saved = this.workspaceState.get<Record<string, string>>(TOOL_CHOICES_KEY, {});
    await this.workspaceState.update(TOOL_CHOICES_KEY, { ...saved, [registryId]: toolId });
    await this.refreshCommands();
  }

  /** A tool the user picked for this workspace wins; otherwise the project's files decide. */
  async refreshCommands(): Promise<void> {
    const seq = ++this.refreshSeq;
    const folder = targetFolder();
    const dir = folder?.uri.fsPath;
    const files = dir ? await listProjectFiles(dir) : [];
    const saved = this.workspaceState.get<Record<string, string>>(TOOL_CHOICES_KEY, {});
    const used = new Set(this.selections.map((s) => s.registry));
    const toolIds: Record<string, string | undefined> = {};
    const notes: Record<string, string> = {};
    for (const registry of registries.filter((r) => used.has(r.id))) {
      const detected = dir ? await detectTool(dir, files, registry) : undefined;
      const chosen = registry.tools.find((t) => t.id === saved[registry.id]);
      toolIds[registry.id] = chosen?.id ?? detected?.tool.id;
      if (chosen && chosen !== detected?.tool) {
        notes[registry.id] = detected ? `your choice · project uses ${detected.tool.label} (${detected.file})` : 'your choice';
      } else if (detected) {
        notes[registry.id] = `detected from ${detected.file}`;
      }
    }
    if (seq !== this.refreshSeq) {
      return;
    }
    const { blocks, rejected } = buildCommands(this.selections, toolIds);
    this.blocks = blocks;
    this.folder = folder;
    this.post({
      type: 'commands',
      blocks: blocks.map((b) => ({ ...b, note: notes[b.registry] })),
      rejected,
      folder: folder?.name,
    });
  }

  private run(registryId: string): void {
    const block = this.blocks.find((b) => b.registry === registryId);
    if (!block || block.kind !== 'command' || !this.folder) {
      return;
    }
    const name = `DepCart: ${this.folder.name}`;
    const terminal =
      vscode.window.terminals.find((t) => t.name === name && t.exitStatus === undefined) ??
      vscode.window.createTerminal({ name, cwd: this.folder.uri });
    terminal.show();
    terminal.sendText(block.command);
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${media('main.css')}" rel="stylesheet">
</head>
<body>
  <input id="query" type="search" placeholder="Search packages" aria-label="Search packages" autofocus>
  <div class="progress" aria-hidden="true"></div>
  <div id="registries" class="toggles" role="group" aria-label="Languages to search"></div>
  <div class="status-row">
    <div id="status" class="status" role="status"></div>
    <button id="ask-ai" class="link" hidden title="Ask the editor's AI model (e.g. GitHub Copilot) for matching packages; only names that exist on the registry are shown">Ask AI</button>
  </div>
  <div id="results" class="results"></div>

  <section class="panel">
    <div class="section-header">
      <h3>Selected <span id="count" class="count"></span></h3>
      <button id="clear" class="link" hidden>Clear all</button>
    </div>
    <ul id="selected" class="selected"></ul>
    <p id="empty-selected" class="hint">Nothing yet. Press + on a search result to add it.</p>
  </section>

  <section class="panel">
    <h3>Install</h3>
    <div id="commands"></div>
  </section>

  <footer class="credit">Developed by <button id="developer" class="credit-link" title="Open Djain912's LinkedIn profile">Djain912</button></footer>

  <script nonce="${nonce}" src="${media('registryIcons.js')}"></script>
  <script nonce="${nonce}" src="${media('main.js')}"></script>
</body>
</html>`;
  }
}
