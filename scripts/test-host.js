// Runs src/test-integration inside a real VS Code extension host (the VS Code installed on this
// machine, or VSCODE_PATH), against a throwaway project that uses all ten ecosystems.
const { runTests } = require('@vscode/test-electron');
const { execFileSync } = require('child_process');
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

async function main() {
  const root = path.resolve(__dirname, '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'depcart-host-'));
  for (const [file, content] of Object.entries(FIXTURE)) {
    fs.writeFileSync(path.join(workspace, file), content);
  }
  const report = path.join(workspace, '..', `${path.basename(workspace)}-report.json`);
  const vscodeExecutablePath = installedVSCode();
  console.log(`VS Code: ${vscodeExecutablePath ?? '(none found: downloading a test copy)'}`);
  console.log(`Test project: ${workspace} (throwaway, deleted when the run ends)`);
  console.log(
    [
      '',
      'About this run:',
      '- A VS Code window opens under automated test control. VS Code blocks all dialogs in test windows,',
      '  including "Do you want Code to open the external website?", so links clicked there do nothing.',
      '  To try DepCart by hand, press F5 in this project or install the .vsix instead.',
      '- One check clicks "Run in terminal", which really runs `npm install zod` in the throwaway test',
      '  project above to prove the command works end to end. Nothing is installed in your own projects.',
      '',
    ].join('\n'),
  );

  let exitCode = 0;
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'out', 'test-integration', 'index.js'),
      extensionTestsEnv: { DEPCART_TEST_REPORT: report, DEPCART_TEST_WORKSPACE: workspace },
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (e) {
    exitCode = 1;
    console.error(`Host tests failed: ${e.message ?? e}`);
  }

  if (fs.existsSync(report)) {
    const { environment, checks } = JSON.parse(fs.readFileSync(report, 'utf8'));
    console.log(`\nRan in VS Code ${environment.vscode} (Node ${environment.node}, ${environment.platform})`);
    for (const c of checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ms !== undefined ? ` (${c.ms} ms)` : ''}${c.detail ? `\n      ${c.detail}` : ''}`);
    }
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
    if (failed) {
      exitCode = 1;
    }
  } else {
    exitCode = 1;
    console.error('No report was written: the extension host did not run the tests.');
  }
  // VS Code has exited by now, so the throwaway project (and the zod it installed) can go.
  try {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    fs.rmSync(report, { force: true });
    console.log('Removed the throwaway test project.');
  } catch (e) {
    console.log(`Could not fully remove ${workspace} (${e.code ?? e.message}); it is safe to delete by hand.`);
  }
  process.exit(exitCode);
}

main();
