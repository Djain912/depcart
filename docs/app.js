(function () {
  const ICONS = window.DEPCART_ICONS || {};
  const REG = {
    npm: { label: 'npm', lang: 'JavaScript / TypeScript', color: '#e0534c', tools: ['npm', 'yarn', 'pnpm', 'bun', 'deno'] },
    pypi: { label: 'PyPI', lang: 'Python', color: '#5a9fd4', tools: ['pip', 'uv', 'poetry', 'pipenv', 'pdm'] },
    go: { label: 'Go modules', lang: 'Go', color: '#00add8', tools: ['go get'] },
    crates: { label: 'crates.io', lang: 'Rust', color: '#dea584', tools: ['cargo add'] },
    maven: { label: 'Maven Central', lang: 'Java / Kotlin', color: '#f89820', tools: ['Maven', 'Gradle (Kotlin)', 'Gradle (Groovy)'] },
    nuget: { label: 'NuGet', lang: '.NET', color: '#9780e5', tools: ['dotnet', 'Paket', 'PackageReference'] },
    rubygems: { label: 'RubyGems', lang: 'Ruby', color: '#e5524b', tools: ['gem', 'bundler'] },
    packagist: { label: 'Packagist', lang: 'PHP', color: '#9a9ed8', tools: ['composer'] },
    pub: { label: 'pub.dev', lang: 'Dart / Flutter', color: '#40a9e8', tools: ['dart pub', 'flutter pub'] },
    hex: { label: 'Hex', lang: 'Elixir', color: '#a374c9', tools: ['mix.exs'] },
  };
  const ORDER = Object.keys(REG);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function icon(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[id] || '');
    path.setAttribute('fill', REG[id].color);
    svg.append(path);
    return svg;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- floating logos behind the hero ----------
  const floats = $('#float-logos');
  const spots = [[4, 12], [44, 4], [88, 10], [12, 78], [52, 90], [94, 70], [30, 40], [70, 30], [80, 88], [20, 58]];
  ORDER.forEach((id, i) => {
    const svg = icon(id);
    svg.style.left = spots[i][0] + '%';
    svg.style.top = spots[i][1] + '%';
    svg.style.animationDelay = (i * -0.7) + 's';
    svg.style.animationDuration = (6 + (i % 4)) + 's';
    floats.append(svg);
  });

  // ---------- logo marquee (list duplicated for a seamless loop) ----------
  const marquee = $('#marquee');
  for (let copy = 0; copy < 2; copy++) {
    ORDER.forEach((id) => {
      const item = el('div', 'marquee-item');
      item.append(icon(id), el('span', '', REG[id].lang + ' · ' + REG[id].label));
      if (copy) item.setAttribute('aria-hidden', 'true');
      marquee.append(item);
    });
  }

  // ---------- language cards ----------
  const langs = $('#langs');
  ORDER.forEach((id, i) => {
    const card = el('article', 'lang reveal');
    card.style.setProperty('--lang-color', REG[id].color);
    card.style.setProperty('--delay', (i % 5) * 0.06 + 's');
    card.append(icon(id), el('h3', '', REG[id].lang), el('small', '', REG[id].label));
    const list = el('ul');
    REG[id].tools.forEach((t) => list.append(el('li', '', t)));
    card.append(list);
    langs.append(card);
  });

  // ---------- scroll reveal + stat count-up ----------
  document.querySelectorAll('.cards .card').forEach((c, i) => c.style.setProperty('--delay', (i % 3) * 0.08 + 's'));
  document.querySelectorAll('.shots .shot').forEach((c, i) => c.style.setProperty('--delay', i * 0.1 + 's'));
  function countUp(node) {
    const target = Number(node.dataset.count);
    if (reducedMotion || target === 0) {
      node.textContent = String(target);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 1100);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        entry.target.querySelectorAll('[data-count]').forEach(countUp);
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.15 },
  );
  document.querySelectorAll('.reveal').forEach((n) => io.observe(n));

  // pointer-following glow on feature cards
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', e.clientX - r.left + 'px');
      card.style.setProperty('--my', e.clientY - r.top + 'px');
    });
  });

  // ---------- hero demo: a looping recreation of the real sidebar ----------
  const SCENES = [
    {
      query: 'zod', on: ['npm', 'pypi', 'go'],
      groups: [{ id: 'npm', count: 10, rows: [['zod', '4.6.5'], ['zod-to-json-schema', '3.25.2'], ['zod-validation-error', '5.0.0']] }, { id: 'pypi', count: 10, rows: [['zodbpickle', '4.1.1']] }],
      install: { id: 'npm', chips: ['npm', 'yarn', 'pnpm', 'bun', 'deno'], active: 'pnpm', cmd: 'pnpm add zod@4.6.5', hint: 'detected from pnpm-lock.yaml' },
    },
    {
      query: 'requests', on: ['npm', 'pypi', 'go'],
      groups: [{ id: 'pypi', count: 10, rows: [['requests', '2.34.2'], ['requests-oauthlib', '2.0.0'], ['requests-toolbelt', '1.0.0']] }, { id: 'npm', count: 10, rows: [['requests', '0.3.0']] }],
      install: { id: 'pypi', chips: ['pip', 'uv', 'poetry', 'pipenv', 'pdm'], active: 'uv', cmd: 'uv add requests==2.34.2', hint: 'detected from uv.lock' },
    },
    {
      query: 'gin', on: ['npm', 'pypi', 'go'],
      groups: [{ id: 'go', count: 10, rows: [['github.com/gin-gonic/gin', 'v1.12.0'], ['github.com/gin-contrib/cors', 'v1.7.9'], ['github.com/swaggo/gin-swagger', 'v1.6.1']] }],
      install: { id: 'go', chips: null, cmd: 'go get github.com/gin-gonic/gin@v1.12.0', hint: 'one command per language' },
    },
    {
      query: 'serde', on: ['crates', 'maven', 'nuget'],
      groups: [{ id: 'crates', count: 10, rows: [['serde', '1.0.229'], ['serde_json', '1.0.151'], ['serde_derive', '1.0.229']] }],
      install: { id: 'crates', chips: null, cmd: 'cargo add serde@1.0.229', hint: 'Rust, Java, .NET and more' },
    },
  ];
  const q = $('#demo-query');
  const toggles = $('#demo-toggles');
  const results = $('#demo-results');
  const install = $('#demo-install');
  const toggleEls = {};
  ORDER.forEach((id) => {
    const t = el('i');
    t.title = REG[id].lang;
    t.append(icon(id));
    toggles.append(t);
    toggleEls[id] = t;
  });

  async function type(node, text, speed) {
    for (let i = 1; i <= text.length; i++) {
      node.textContent = text.slice(0, i);
      await sleep(speed);
    }
  }

  function renderInstall(sc) {
    const logo = $('#demo-install-logo');
    logo.replaceChildren(icon(sc.install.id));
    $('#demo-install-label').textContent = REG[sc.install.id].lang.split(' ')[0];
    const chips = $('#demo-chips');
    chips.replaceChildren();
    chips.style.display = sc.install.chips ? 'flex' : 'none';
    (sc.install.chips || []).forEach((c) => {
      const s = el('span', c === sc.install.active ? 'on' : '', c);
      chips.append(s);
    });
    $('#demo-hint').textContent = sc.install.hint;
  }

  async function playScene(sc) {
    ORDER.forEach((id) => toggleEls[id].classList.toggle('on', sc.on.includes(id)));
    install.classList.remove('show');
    results.replaceChildren();
    q.textContent = '';
    await sleep(500);
    await type(q, sc.query, 110);
    await sleep(350);
    let firstPlus = null;
    for (const g of sc.groups) {
      const group = el('div', 'dgroup');
      const head = el('div', 'dgroup-head');
      head.append(icon(g.id), el('span', '', REG[g.id].lang.split(' ')[0]), el('span', 'count', String(g.count)));
      group.append(head);
      g.rows.forEach(([name, version], i) => {
        const row = el('div', 'drow');
        row.style.animationDelay = i * 0.07 + 's';
        const plus = el('span', 'plus', '+');
        row.append(el('b', '', name), el('small', '', version), plus);
        if (!firstPlus) firstPlus = plus;
        group.append(row);
      });
      results.append(group);
      await sleep(420);
    }
    await sleep(500);
    firstPlus.classList.add('press');
    await sleep(180);
    firstPlus.classList.remove('press');
    firstPlus.classList.add('done');
    firstPlus.textContent = '✓';
    renderInstall(sc);
    const cmd = $('#demo-cmd');
    cmd.textContent = '';
    install.classList.add('show');
    await sleep(300);
    await type(cmd, sc.install.cmd, 28);
    await sleep(2400);
  }

  async function loopDemo() {
    if (reducedMotion) {
      const sc = SCENES[0];
      ORDER.forEach((id) => toggleEls[id].classList.toggle('on', sc.on.includes(id)));
      q.textContent = sc.query;
      renderInstall(sc);
      $('#demo-cmd').textContent = sc.install.cmd;
      install.classList.add('show');
      return;
    }
    for (let i = 0; ; i = (i + 1) % SCENES.length) {
      await playScene(SCENES[i]);
    }
  }
  loopDemo();

  // ---------- "how it picks the tool" playground ----------
  const FILES = [
    { file: 'pnpm-lock.yaml', id: 'npm', tool: 'pnpm', cmd: 'pnpm add zod@4.6.5' },
    { file: 'yarn.lock', id: 'npm', tool: 'yarn', cmd: 'yarn add zod@4.6.5' },
    { file: 'bun.lock', id: 'npm', tool: 'bun', cmd: 'bun add zod@4.6.5' },
    { file: 'uv.lock', id: 'pypi', tool: 'uv', cmd: 'uv add requests==2.34.2' },
    { file: 'poetry.lock', id: 'pypi', tool: 'poetry', cmd: 'poetry add requests==2.34.2' },
    { file: 'Pipfile', id: 'pypi', tool: 'pipenv', cmd: 'pipenv install requests==2.34.2' },
    { file: 'go.mod', id: 'go', tool: 'go get', cmd: 'go get github.com/gin-gonic/gin@v1.12.0' },
    { file: 'Cargo.toml', id: 'crates', tool: 'cargo', cmd: 'cargo add serde@1.0.229' },
    { file: 'build.gradle.kts', id: 'maven', tool: 'Gradle (Kotlin)', cmd: 'implementation("com.google.guava:guava:33.7.1-jre")' },
    { file: 'paket.dependencies', id: 'nuget', tool: 'Paket', cmd: 'paket add Newtonsoft.Json --version 13.0.4' },
    { file: 'Gemfile', id: 'rubygems', tool: 'bundler', cmd: 'bundle add rails --version 8.1.4' },
    { file: 'composer.json', id: 'packagist', tool: 'composer', cmd: 'composer require monolog/monolog:3.12.0' },
    { file: 'pubspec.yaml', id: 'pub', tool: 'flutter pub', cmd: 'flutter pub add http:1.6.0' },
    { file: 'mix.exs', id: 'hex', tool: 'mix.exs', cmd: '{:phoenix, "1.8.15"}' },
  ];
  const filesEl = $('#files');
  const detected = $('#detected');
  const pgCmd = $('#pg-cmd');
  const fileButtons = FILES.map((f, i) => {
    const b = el('button', 'file');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.append(icon(f.id), el('span', '', f.file));
    b.addEventListener('click', () => {
      userPicked = true;
      select(i);
    });
    filesEl.append(b);
    return b;
  });
  let current = -1;
  let userPicked = false;
  let typing = 0;
  async function select(i) {
    if (i === current) return;
    current = i;
    const token = ++typing;
    fileButtons.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    const f = FILES[i];
    detected.replaceChildren();
    const line1 = el('div');
    line1.append('found ', el('b', '', f.file), ' → ', el('span', 'tool', f.tool));
    const line2 = el('div', '', REG[f.id].lang + ' · ' + REG[f.id].label);
    detected.append(line1, line2);
    pgCmd.textContent = '';
    if (reducedMotion) {
      pgCmd.textContent = f.cmd;
      return;
    }
    for (let c = 1; c <= f.cmd.length; c++) {
      if (token !== typing) return;
      pgCmd.textContent = f.cmd.slice(0, c);
      await sleep(22);
    }
  }
  select(0);
  // cycle through files until the visitor picks one
  let auto = 0;
  setInterval(() => {
    if (userPicked || document.hidden) return;
    auto = (auto + 1) % FILES.length;
    select(auto);
  }, 2600);

  // ---------- latest release from GitHub ----------
  fetch('https://api.github.com/repos/Djain912/depcart/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((release) => {
      const vsix = (release.assets || []).find((a) => a.name.endsWith('.vsix'));
      if (!vsix) return;
      document.querySelectorAll('.vsix-link').forEach((a) => (a.href = vsix.browser_download_url));
      document.querySelectorAll('.vsix-version').forEach((s) => (s.textContent = release.tag_name));
      const kb = Math.round(vsix.size / 1024);
      $('#release-line').textContent = 'DepCart ' + release.tag_name + ' · ' + vsix.name + ' · ' + kb + ' KB';
      $('#install-cmd').textContent = 'code --install-extension ' + vsix.name;
    })
    .catch(() => {
      // Links already point at the releases page, which always works.
    });

  // ---------- copy buttons ----------
  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = document.querySelector(btn.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Select & copy';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1600);
    });
  });
})();
