# Changelog

## 1.0.2 (2026-09-26)

- The credit bar reads "Developed by Darshan Jain" and still links to the LinkedIn profile.
- Opening a link no longer leaves an unhandled error when VS Code's "open external website?" prompt is cancelled or blocked.
- `npm run test:host` explains what the test window is (VS Code blocks dialogs there, so links do nothing) and deletes its throwaway test project, including the package it installs, when the run ends.

## 1.0.1 (2026-09-26)

- A small "Developed by Djain912" bar at the bottom of the sidebar links to the developer's LinkedIn profile.
- Developer details in the extension manifest and README.
- Repository links use the correct `Djain912/depcart` capitalisation.

## 1.0.0 (2026-09-26)

First release.

- Search ten package registries from one VS Code sidebar: npm, PyPI, Go modules, crates.io, Maven Central, NuGet, RubyGems, Packagist, pub.dev and Hex.
- Results grouped by language with registry logos. The language with an exact name match comes first, then the languages your project uses.
- Click a package name to open its page on the official registry website.
- Pick an exact version for every package. Stable releases are listed before pre-releases.
- One install command per language, never mixed. Switch between every tool a language offers:
  - JavaScript / TypeScript: npm, yarn, pnpm, bun, deno
  - Python: pip, uv, poetry, pipenv, pdm
  - Ruby: gem, bundler
  - .NET: dotnet CLI, Paket, PackageReference
  - Java / Kotlin: Maven, Gradle (Kotlin), Gradle (Groovy)
  - Dart / Flutter: dart pub, flutter pub
- Detects the tool your project uses from lockfiles and config (for example `pnpm-lock.yaml`, `uv.lock`, `[tool.poetry]`, a Flutter `pubspec.yaml`) and remembers your choice per project.
- Copy a command, or run it in a terminal opened at your project folder.
- Backup search through the ecosyste.ms package index when a registry's own search is slow, down or finds nothing.
- Optional AI suggestions through VS Code's language model API (for example GitHub Copilot) when nothing is found. Every suggestion is checked against the registry before it is shown.
- Package names and versions are validated before they go into a command, so a malicious name cannot inject shell syntax or flags.
