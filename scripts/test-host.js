// Runs src/test-integration inside a real VS Code extension host (the VS Code installed on this
// machine, or VSCODE_PATH), against throwaway projects that use all ten ecosystems: once trusted,
// once in Restricted Mode.
const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } = require('@vscode/test-electron');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function installedVSCode() {
  if (process.env.VSCODE_PATH) {
    return process.env.VSCODE_PATH;
  }
  const candidates = [];
  if (process.platform === 'win32') {
    try {
      const cli = execFileSync('where.exe', ['code'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
      candidates.push(path.join(path.dirname(path.dirname(cli)), 'Code.exe'));
    } catch {
      // Not on PATH.
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/Applications/Visual Studio Code.app/Contents/MacOS/Code');
  } else {
    candidates.push('/usr/share/code/code', '/usr/lib/code/code');
  }
  return candidates.find((c) => fs.existsSync(c));
}

const FIXTURE = {
  'package.json': JSON.stringify({ name: 'depcart-fixture', version: '1.0.0', private: true }, null, 2),
  'package-lock.json': JSON.stringify(
    { name: 'depcart-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'depcart-fixture', version: '1.0.0' } } },
    null,
    2,
  ),
  'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.1.0"\n\n[tool.poetry]\npackage-mode = false\n',
  'go.mod': 'module example.com/fixture\n\ngo 1.22\n',
  'Cargo.toml': '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
  'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>fixture</artifactId><version>1.0</version></project>\n',
  'Fixture.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n',
  Gemfile: 'source "https://rubygems.org"\n',
  'composer.json': JSON.stringify({ name: 'example/fixture', require: {} }, null, 2),
  'pubspec.yaml': 'name: fixture\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n',
  'mix.exs': 'defmodule Fixture.MixProject do\n  use Mix.Project\n  def project, do: [app: :fixture, version: "0.1.0", deps: []]\nend\n',
};

function makeWorkspace(extra = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'depcart-host-'));
  for (const [file, content] of Object.entries({ ...FIXTURE, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), content);
  }
  return workspace;
}

/** Runs the VS Code CLI (code / code.cmd) next to the given executable. */
function vscodeCli(executable, args) {
  const cli = resolveCliPathFromVSCodeExecutablePath(executable);
  const shell = process.platform === 'win32'; // .cmd files need a shell (CVE-2024-27980)
  const result = spawnSync(shell ? `"${cli}"` : cli, shell ? args.map((a) => `"${a}"`) : args, { shell, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${path.basename(cli)} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error}`);
  }
  return result.stdout;
}

/**
 * The Restricted Mode run installs the packaged .vsix the way a user does: VS Code never disables an
 * extension loaded for development, so only an installed copy shows whether DepCart really appears in
 * Restricted Mode. The tests themselves run from an empty stand-in extension.
 *
 * runTests always passes --disable-workspace-trust, so this run starts VS Code itself with the same
 * flags minus that one, in a fresh profile that never shows the trust prompt: a folder that was never
 * trusted then opens in Restricted Mode, as it does for a user who clicks "No".
 */
function runRestricted(executable, root, workspace, env) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'depcart-profile-'));
  const userData = path.join(profile, 'user-data');
  const extensions = path.join(profile, 'extensions');
  const settings = path.join(userData, 'User', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    JSON.stringify({
      'security.workspace.trust.enabled': true,
      'security.workspace.trust.startupPrompt': 'never',
      'security.workspace.trust.banner': 'never',
    }),
  );
  const runner = path.join(profile, 'test-runner');
  fs.mkdirSync(runner);
  fs.writeFileSync(
    path.join(runner, 'package.json'),
    JSON.stringify({ name: 'depcart-host-tests', publisher: 'depcart-tests', version: '0.0.0', engines: { vscode: '^1.90.0' } }),
  );
  const vsix = path.join(profile, 'depcart-test.vsix');
  try {
    execFileSync(process.execPath, [path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), 'package', '--out', vsix], { cwd: root, stdio: 'pipe' });
    vscodeCli(executable, [`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--install-extension', vsix, '--force']);
  } catch (e) {
    fs.rmSync(profile, { recursive: true, force: true });
    return Promise.resolve(`could not package and install the .vsix: ${e.stderr?.toString().trim() || e.message}`);
  }
  const args = [
    workspace,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-cached-data',
    `--extensionTestsPath=${path.join(root, 'out', 'test-integration', 'index.js')}`,
    `--extensionDevelopmentPath=${runner}`,
    `--user-data-dir=${userData}`,
    `--extensions-dir=${extensions}`,
  ];
  return new Promise((resolve) => {
    const child = spawn(executable, args, { env: { ...process.env, ...env, DEPCART_TEST_EXTENSIONS_DIR: extensions } });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', (e) => resolve(`could not start VS Code: ${e.message}`));
    child.on('exit', (code) => {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      resolve(code === 0 ? undefined : `VS Code exited with code ${code}`);
    });
  });
}

/** Prints a run's checks; returns false when any failed or none were recorded. */
function printReport(title, report) {
  if (!fs.existsSync(report)) {
    console.error(`\n${title}: no report was written, so the extension host did not run the tests.`);
    return false;
  }
  const { environment, checks } = JSON.parse(fs.readFileSync(report, 'utf8'));
  console.log(`\n${title}: VS Code ${environment.vscode} (Node ${environment.node}, ${environment.platform})`);
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ms !== undefined ? ` (${c.ms} ms)` : ''}${c.detail ? `\n      ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed.`);
  return failed === 0 && checks.length > 0;
}

function removeQuietly(...paths) {
  for (const p of paths) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (e) {
      console.log(`Could not fully remove ${p} (${e.code ?? e.message}); it is safe to delete by hand.`);
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const workspace = makeWorkspace();
  // A workspace setting Restricted Mode must ignore (depcart.aiFallback is a restricted setting).
  const restrictedWorkspace = makeWorkspace({ '.vscode/settings.json': JSON.stringify({ 'depcart.aiFallback': false }) });
  const report = `${workspace}-report.json`;
  const restrictedReport = `${restrictedWorkspace}-report.json`;
  const vscodeExecutablePath = installedVSCode() ?? (await downloadAndUnzipVSCode());
  console.log(`VS Code: ${vscodeExecutablePath}`);
  console.log(`Test projects: ${workspace}, ${restrictedWorkspace} (throwaway, deleted when the run ends)`);
  console.log(
    [
      '',
      'About this run:',
      '- Two VS Code windows open in turn under automated test control: one with the test project trusted,',
      '  then one with a copy in Restricted Mode and DepCart installed from a freshly packaged .vsix.',
      '  VS Code blocks all dialogs in test windows, including',
      '  "Do you want Code to open the external website?", so links clicked there do nothing.',
      '  To try DepCart by hand, press F5 in this project or install the .vsix instead.',
      '- One check clicks "Run in terminal", which really runs `npm install zod` in the throwaway test',
      '  project above to prove the command works end to end. Nothing is installed in your own projects.',
      '',
    ].join('\n'),
  );

  let ok = true;
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'out', 'test-integration', 'index.js'),
      extensionTestsEnv: { DEPCART_TEST_REPORT: report, DEPCART_TEST_WORKSPACE: workspace },
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (e) {
    ok = false;
    console.error(`Host tests failed: ${e.message ?? e}`);
  }
  const restrictedError = await runRestricted(vscodeExecutablePath, root, restrictedWorkspace, {
    DEPCART_TEST_REPORT: restrictedReport,
    DEPCART_TEST_WORKSPACE: restrictedWorkspace,
    DEPCART_TEST_MODE: 'restricted',
  });
  if (restrictedError) {
    ok = false;
    console.error(`Restricted Mode host tests failed: ${restrictedError}`);
  }

  ok = printReport('Trusted folder', report) && ok;
  ok = printReport('Restricted Mode', restrictedReport) && ok;
  // VS Code has exited by now, so the throwaway projects (and the zod one of them installed) can go.
  removeQuietly(workspace, restrictedWorkspace, report, restrictedReport);
  console.log('Removed the throwaway test projects.');
  process.exit(ok ? 0 : 1);
}

main();
