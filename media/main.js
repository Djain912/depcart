// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code into webviews.
  const vscode = acquireVsCodeApi();
  const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  const queryInput = /** @type {HTMLInputElement} */ (el('query'));
  const registriesEl = el('registries');
  const statusEl = el('status');
  const askAiBtn = el('ask-ai');
  const resultsEl = el('results');
  const selectedEl = el('selected');
  const emptySelectedEl = el('empty-selected');
  const countEl = el('count');
  const clearBtn = el('clear');
  const commandsEl = el('commands');

  /**
   * @typedef {{ id: string, label: string, title: string, site: string, tools: { id: string, label: string }[] }} RegistryInfo
   * @typedef {{ registry: string, name: string, version: string, description: string, via?: string }} Result
   * @typedef {{ registry: string, name: string, version: string, versions: string[], prereleases?: string[], latest: string, loading?: boolean, error?: string }} Item
   * @typedef {{ registry: string, tool: string, kind: 'command' | 'snippet', command: string, count: number, note?: string, missing?: { program: string, installName: string, alternative?: { id: string, label: string } } }} Block
   */

  const saved = vscode.getState() || {};
  let query = saved.query || '';
  /** @type {string[] | null} Registries to search; null until the user picks (then detected ones are used). */
  let chosen = Array.isArray(saved.chosen) ? saved.chosen : null;
  /** @type {Item[]} */
  let selected = saved.selected || [];

  /** @type {RegistryInfo[]} */
  let registries = [];
  /** @type {string[]} */
  let detected = [];
  /** @type {Record<string, Result[]>} */
  let resultsByRegistry = {};
  /** @type {Record<string, string>} */
  let searchErrors = {};
  /** @type {Set<string>} */
  let pending = new Set();
  /** Groups showing every result / folded away, for the current search only. */
  let expanded = new Set();
  let folded = new Set();
  let currentRequest = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounce;
  let aiAvailable = false;
  /** @type {Set<string>} */
  let aiPending = new Set();
  let aiMessage = '';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let watchdog;

  // The extension always answers well within these; they only guard against a host that has gone away.
  const SEARCH_WATCHDOG_MS = 25000;
  const AI_WATCHDOG_MS = 60000;
  const RESULTS_PER_GROUP = 3;

  const info = (/** @type {string} */ id) => registries.find((r) => r.id === id);
  const label = (/** @type {string} */ id) => info(id)?.label ?? id;
  const keyOf = (/** @type {{registry: string, name: string}} */ p) => `${p.registry}:${p.name}`;
  const isSelected = (/** @type {Result} */ r) => selected.some((s) => keyOf(s) === keyOf(r));
  const activeRegistries = () => chosen ?? (detected.length ? detected : registries.map((r) => r.id));
  const listOf = (/** @type {string[]} */ names) =>
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');

  /**
   * Builds DOM nodes; string children become text nodes, so registry data is never parsed as HTML.
   * @param {string} tag
   * @param {Record<string, any>} props
   * @param {...(Node | string | null | undefined | false)} children
   */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child != null && child !== false) node.append(child);
    return node;
  }

  const GLYPHS = {
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
    chevron: 'M9.3 6.7 10.7 5.3 17.4 12l-6.7 6.7-1.4-1.4 5.3-5.3z',
    close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
    warning: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  };

  function svg(/** @type {string} */ path, /** @type {string} */ cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const node = document.createElementNS(ns, 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('class', cls);
    node.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    node.append(p);
    return node;
  }

  /** @type {Record<string, string>} */
  // @ts-ignore set by registryIcons.js
  const ICONS = window.DEPCART_ICONS || {};
  const registryIcon = (/** @type {string} */ id) => (ICONS[id] ? svg(ICONS[id], `icon icon-${id}`) : h('span', { class: 'icon' }));

  function persist() {
    vscode.setState({ query, chosen, selected });
  }

  function syncSelection() {
    persist();
    vscode.postMessage({
      type: 'selection',
      items: selected.filter((s) => s.version).map(({ registry, name, version }) => ({ registry, name, version })),
    });
  }

  function open(/** @type {{registry: string, name: string}} */ p) {
    vscode.postMessage({ type: 'open', registry: p.registry, name: p.name });
  }

  /** A package name that opens its page on the official registry website. */
  function packageLink(/** @type {{registry: string, name: string}} */ p) {
    return h('button', { class: 'pkg', title: `${p.name} — open on ${info(p.registry)?.site ?? 'the registry'}`, onclick: () => open(p) }, p.name);
  }

  function renderToggles() {
    const active = new Set(activeRegistries());
    const all = registries.length > 0 && active.size === registries.length;
    registriesEl.replaceChildren(
      h(
        'button',
        {
          class: 'toggle all',
          'aria-pressed': String(all),
          title: all ? 'Only the languages this project uses' : 'Search every language',
          onclick: () => {
            chosen = all ? (detected.length ? [...detected] : [registries[0].id]) : registries.map((r) => r.id);
            onRegistriesChanged();
          },
        },
        'All',
      ),
      ...registries.map((r) =>
        h(
          'button',
          {
            class: 'toggle',
            'aria-pressed': String(active.has(r.id)),
            'aria-label': r.label,
            title: `${r.label}: ${r.title}${detected.includes(r.id) ? ' (used in this project)' : ''}`,
            onclick: () => {
              const next = new Set(activeRegistries());
              if (next.has(r.id)) next.delete(r.id);
              else next.add(r.id);
              chosen = registries.map((x) => x.id).filter((id) => next.has(id));
              onRegistriesChanged();
            },
          },
          registryIcon(r.id),
        ),
      ),
    );
  }

  function onRegistriesChanged() {
    persist();
    renderToggles();
    runSearch();
  }

  function renderStatus() {
    const searched = query.trim().length >= 2;
    const active = activeRegistries();
    const hasResults = active.some((id) => (resultsByRegistry[id] ?? []).length > 0);
    let text = '';
    if (registries.length && active.length === 0) text = 'Pick at least one language above.';
    else if (pending.size) text = `Searching ${listOf([...pending].map(label))}…`;
    else if (aiPending.size) text = 'Asking AI for suggestions…';
    else if (aiMessage) text = aiMessage;
    else if (searched && !hasResults && !Object.keys(searchErrors).length) text = 'No packages found.';
    else if (!searched && registries.length) text = `Searching ${listOf(active.map(label))}`;
    statusEl.textContent = text;
    document.body.classList.toggle('busy', pending.size > 0 || aiPending.size > 0);
    askAiBtn.hidden = !aiAvailable || !searched || pending.size > 0 || aiPending.size > 0 || active.length === 0;
  }

  /** Stops showing "Searching…" if the extension host never answers (e.g. it was restarted). */
  function armWatchdog(/** @type {number} */ requestId, /** @type {number} */ ms) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (requestId !== currentRequest) return;
      for (const id of pending) searchErrors[id] = 'timed out';
      pending.clear();
      if (aiPending.size) aiMessage = 'AI did not answer';
      aiPending.clear();
      renderStatus();
      renderResults();
    }, ms);
  }

  /** A result whose name (or last path segment, e.g. Go's ".../gin") is exactly the query. */
  function isExactMatch(/** @type {string} */ name, /** @type {string} */ q) {
    const n = name.toLowerCase();
    return n === q || n.split(/[/:]/).pop() === q;
  }

  /** Languages with results: exact name matches first, then the project's own languages, then filter order. */
  function groupOrder() {
    const q = query.trim().toLowerCase();
    return activeRegistries()
      .map((id, order) => ({ id, order, list: resultsByRegistry[id] ?? [], ours: detected.includes(id) }))
      .filter((g) => g.list.length > 0)
      .map((g) => ({ ...g, exact: g.list.slice(0, RESULTS_PER_GROUP).some((r) => isExactMatch(r.name, q)) }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.ours) - Number(a.ours) || a.order - b.order);
  }

  function resultRow(/** @type {Result} */ r) {
    const added = isSelected(r);
    return h(
      'li',
      { class: 'result' },
      h(
        'div',
        { class: 'line' },
        packageLink(r),
        r.via === 'ai' && h('span', { class: 'tag', title: 'Suggested by AI and verified to exist on the registry. Check it is the package you expect.' }, 'AI'),
        h('span', { class: 'ver' }, r.version || ''),
        h(
          'button',
          {
            class: 'icon-button add',
            title: added ? 'Added' : 'Add to install list',
            'aria-label': added ? `${r.name} added` : `Add ${r.name}`,
            disabled: added,
            onclick: () => add(r),
          },
          svg(added ? GLYPHS.check : GLYPHS.plus, 'glyph'),
        ),
      ),
      r.description && h('div', { class: 'desc', title: r.description }, r.description),
    );
  }

  function renderResults() {
    const groups = groupOrder();
    const single = groups.length === 1;
    const nodes = groups.map(({ id, list }) => {
      const isOpen = !folded.has(id);
      const limit = single || expanded.has(id) ? list.length : RESULTS_PER_GROUP;
      const hidden = list.length - limit;
      return h(
        'section',
        { class: 'group' },
        h(
          'button',
          {
            class: 'group-header',
            'aria-expanded': String(isOpen),
            title: info(id)?.title,
            onclick: () => {
              if (isOpen) folded.add(id);
              else folded.delete(id);
              renderResults();
            },
          },
          svg(GLYPHS.chevron, 'chevron'),
          registryIcon(id),
          h('span', { class: 'group-name' }, label(id)),
          h('span', { class: 'count' }, String(list.length)),
        ),
        isOpen && h('ul', { class: 'rows' }, ...list.slice(0, limit).map(resultRow)),
        isOpen &&
          !single &&
          (hidden > 0 || expanded.has(id)) &&
          h(
            'button',
            {
              class: 'more',
              onclick: () => {
                if (expanded.has(id)) expanded.delete(id);
                else expanded.add(id);
                renderResults();
              },
            },
            hidden > 0 ? `Show ${hidden} more` : 'Show fewer',
          ),
      );
    });
    const active = activeRegistries();
    const answered = active.filter((id) => !pending.has(id));
    const empty = answered.filter((id) => (resultsByRegistry[id] ?? []).length === 0 && !searchErrors[id] && id in resultsByRegistry);
    const failed = active.filter((id) => searchErrors[id]);
    if (empty.length || failed.length) {
      nodes.push(
        h(
          'div',
          { class: 'footer' },
          empty.length > 0 && h('div', {}, `No matches in ${listOf(empty.map(label))}`),
          ...failed.map((id) => h('div', { class: 'error' }, `${label(id)} couldn't be searched: ${searchErrors[id]}`)),
        ),
      );
    }
    resultsEl.replaceChildren(...nodes);
  }

  /** Releases first, then pre-releases, so hundreds of canary builds don't bury stable versions. */
  function versionOptions(/** @type {Item} */ item) {
    if (item.loading && item.versions.length === 0) return [h('option', {}, 'loading…')];
    const option = (/** @type {string} */ v) => h('option', { value: v }, v === item.latest ? `${v} (latest)` : v);
    const pre = new Set(item.prereleases || []);
    const releases = item.versions.filter((v) => !pre.has(v));
    const prereleases = item.versions.filter((v) => pre.has(v));
    if (!releases.length || !prereleases.length) return item.versions.map(option);
    return [h('optgroup', { label: 'Releases' }, ...releases.map(option)), h('optgroup', { label: 'Pre-releases' }, ...prereleases.map(option))];
  }

  function renderSelected() {
    countEl.textContent = selected.length ? String(selected.length) : '';
    clearBtn.hidden = selected.length === 0;
    emptySelectedEl.hidden = selected.length > 0;
    selectedEl.replaceChildren(
      ...selected.map((item) => {
        const picker = /** @type {HTMLSelectElement} */ (
          h(
            'select',
            {
              'aria-label': `Version of ${item.name}`,
              disabled: item.loading || item.versions.length === 0,
              onchange: (/** @type {Event} */ e) => {
                item.version = /** @type {HTMLSelectElement} */ (e.target).value;
                syncSelection();
              },
            },
            ...versionOptions(item),
          )
        );
        picker.value = item.version;
        return h(
          'li',
          {},
          h(
            'div',
            { class: 'line' },
            registryIcon(item.registry),
            packageLink(item),
            picker,
            h(
              'button',
              { class: 'icon-button remove', title: 'Remove', 'aria-label': `Remove ${item.name}`, onclick: () => remove(item) },
              svg(GLYPHS.close, 'glyph'),
            ),
          ),
          item.error && h('div', { class: 'desc error' }, `Couldn't load versions: ${item.error}`),
        );
      }),
    );
  }

  /** Shown when the program a command runs isn't installed, so Run in terminal won't just fail. */
  function missingNotice(/** @type {Block} */ b) {
    const { program, installName, alternative } = b.missing;
    return h(
      'div',
      { class: 'missing', title: 'Installed it already? Restart VS Code so it picks up the new PATH.' },
      svg(GLYPHS.warning, 'glyph'),
      h('span', {}, `${program} isn't installed`),
      h(
        'button',
        { class: 'link-button', onclick: () => vscode.postMessage({ type: 'openInstallGuide', registry: b.registry, tool: b.tool }) },
        `Install ${installName}`,
      ),
      alternative &&
        h(
          'button',
          { class: 'link-button', onclick: () => vscode.postMessage({ type: 'setTool', registry: b.registry, tool: alternative.id }) },
          `Use ${alternative.label}`,
        ),
    );
  }

  /** @param {{ blocks: Block[], rejected: {name: string, version: string}[], folder?: string }} msg */
  function renderCommands(msg) {
    const nodes = msg.blocks.map((b) => {
      const tools = info(b.registry)?.tools ?? [];
      const isSnippet = b.kind === 'snippet';
      return h(
        'div',
        { class: 'block' },
        h(
          'div',
          { class: 'block-title' },
          registryIcon(b.registry),
          h('span', {}, label(b.registry)),
          h('span', { class: 'count' }, `${b.count} package${b.count === 1 ? '' : 's'}`),
        ),
        tools.length > 1 &&
          h(
            'div',
            { class: 'chips', role: 'group', 'aria-label': `${label(b.registry)} install tool` },
            ...tools.map((t) =>
              h(
                'button',
                {
                  class: 'chip',
                  'aria-pressed': String(t.id === b.tool),
                  onclick: () => t.id !== b.tool && vscode.postMessage({ type: 'setTool', registry: b.registry, tool: t.id }),
                },
                t.label,
              ),
            ),
          ),
        h('pre', { class: isSnippet ? 'snippet' : '' }, b.command),
        b.missing && missingNotice(b),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', onclick: () => vscode.postMessage({ type: 'copy', registry: b.registry }) }, 'Copy'),
          !isSnippet &&
            h(
              'button',
              {
                class: 'btn secondary',
                disabled: !msg.folder,
                title: msg.folder ? `Run in a terminal at ${msg.folder}` : 'Open a folder to run commands',
                onclick: () => vscode.postMessage({ type: 'run', registry: b.registry }),
              },
              'Run in terminal',
            ),
        ),
        h('div', { class: 'hint' }, [isSnippet ? 'Paste into your build file' : null, b.note].filter(Boolean).join(' · ')),
      );
    });
    if (msg.rejected.length) {
      const skipped = msg.rejected.map((r) => `${r.name}@${r.version}`).join(', ');
      nodes.push(h('p', { class: 'error' }, `Skipped (unsafe or invalid name/version): ${skipped}`));
    }
    if (nodes.length === 0) {
      nodes.push(h('p', { class: 'hint' }, 'One command per language appears here as you add packages.'));
    }
    commandsEl.replaceChildren(...nodes);
  }

  function refresh() {
    renderSelected();
    renderResults();
    syncSelection();
  }

  function requestVersions(/** @type {Item} */ item) {
    vscode.postMessage({ type: 'versions', registry: item.registry, name: item.name });
  }

  function add(/** @type {Result} */ r) {
    if (isSelected(r)) return;
    /** @type {Item} */
    const item = {
      registry: r.registry,
      name: r.name,
      version: r.version,
      versions: r.version ? [r.version] : [],
      prereleases: [],
      latest: r.version,
      loading: true,
    };
    selected.push(item);
    requestVersions(item);
    refresh();
  }

  function remove(/** @type {Item} */ item) {
    selected = selected.filter((s) => s !== item);
    refresh();
  }

  function runSearch() {
    clearTimeout(debounce);
    const q = query.trim();
    const requestId = ++currentRequest;
    const targets = activeRegistries();
    resultsByRegistry = {};
    searchErrors = {};
    expanded = new Set();
    folded = new Set();
    aiPending = new Set();
    aiMessage = '';
    pending = new Set(q.length >= 2 ? targets : []);
    if (pending.size) {
      vscode.postMessage({ type: 'search', query: q, registries: targets, requestId });
      armWatchdog(requestId, SEARCH_WATCHDOG_MS);
    }
    renderStatus();
    renderResults();
  }

  askAiBtn.addEventListener('click', () => {
    aiMessage = '';
    vscode.postMessage({ type: 'askAi', query: query.trim(), registries: activeRegistries(), requestId: currentRequest });
  });

  queryInput.addEventListener('input', () => {
    query = queryInput.value;
    persist();
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 300);
  });
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });
  el('developer').addEventListener('click', () => vscode.postMessage({ type: 'openDeveloper' }));
  el('feedback').addEventListener('click', () => vscode.postMessage({ type: 'openFeedback' }));
  clearBtn.addEventListener('click', () => {
    selected = [];
    refresh();
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        registries = msg.registries;
        detected = msg.detected;
        aiAvailable = msg.ai;
        if (chosen) chosen = chosen.filter((id) => info(id));
        renderToggles();
        renderSelected();
        renderStatus();
        selected.filter((s) => s.loading).forEach(requestVersions);
        syncSelection();
        if (query.trim()) runSearch();
        break;
      case 'searchResults':
        if (msg.requestId !== currentRequest) return;
        resultsByRegistry[msg.registry] = msg.results;
        if (msg.error) searchErrors[msg.registry] = msg.error;
        else delete searchErrors[msg.registry];
        pending.delete(msg.registry);
        renderStatus();
        renderResults();
        break;
      case 'aiAvailability':
        aiAvailable = msg.available;
        renderStatus();
        break;
      case 'aiStarted':
        if (msg.requestId !== currentRequest) return;
        aiPending = new Set(msg.registries);
        aiMessage = '';
        armWatchdog(msg.requestId, AI_WATCHDOG_MS);
        renderStatus();
        break;
      case 'aiResults': {
        if (msg.requestId !== currentRequest) return;
        aiPending = new Set();
        let added = 0;
        for (const r of msg.results) {
          const list = (resultsByRegistry[r.registry] ??= []);
          if (!list.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) {
            list.push(r);
            added++;
          }
        }
        if (msg.error) aiMessage = msg.requested ? `AI: ${msg.error}` : '';
        else if (msg.requested && added === 0) aiMessage = 'AI found no other matching packages';
        renderStatus();
        renderResults();
        break;
      }
      case 'versions': {
        const item = selected.find((s) => s.registry === msg.registry && s.name === msg.name);
        if (!item) return;
        item.loading = false;
        if (msg.error) {
          item.error = msg.error;
        } else {
          item.error = undefined;
          item.versions = msg.versions;
          item.prereleases = msg.prereleases;
          item.latest = msg.latest;
          item.version = msg.latest;
        }
        renderSelected();
        syncSelection();
        break;
      }
      case 'commands':
        renderCommands(msg);
        break;
    }
  });

  queryInput.value = query;
  vscode.postMessage({ type: 'ready' });
})();
