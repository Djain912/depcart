# Changelog

## 0.0.4 (2026-10-19)

- **Package health in every search result.** Under each package: how widely it's used (downloads last month or in total, or how many packages depend on it), when it was last released and when its repository last got a commit. Deprecated packages, archived repositories and packages with no release or commit in over 2 years are flagged in color. Hover for exact numbers and dates. The data comes from the ecosyste.ms package index. Thanks to the Reddit feedback that asked for it.
- **The DepCart icon now shows in Restricted Mode.** Before, VS Code turned DepCart off in folders you hadn't trusted, so its Activity Bar icon disappeared. Now search, package health and Copy work there too. **Run in terminal** still waits until you trust the folder, and offers to open the workspace trust settings.
- **DepCart: Search Packages** in the Command Palette opens the sidebar with the cursor in the search box. Assign it a keyboard shortcut for one-keystroke access.
- The README's Marketplace badges work again, and the Product Hunt badge no longer breaks packaging.

## 0.0.3 (2026-09-27)

- **No more "command not found".** DepCart now checks whether the program a command needs (npm, pnpm, uv, poetry, cargo, go, dotnet, composer, flutter, ...) is installed. If it isn't, the Install section says so and links to the official install guide. If your project doesn't require that tool, it also offers another one you have. **Run in terminal** checks again before running and lets you install, switch or run anyway.
- If only `pip3` is installed, pip commands use `pip3`.
- A timing test that could fail on a busy CI machine now has a safe margin.

## 0.0.2 (2026-09-26)

- **Feedback in one click:** a **Feedback** link in the sidebar's credit bar and a feedback button in the view's title bar open GitHub's issue forms (bug report, feature request, new registry or tool). The same is available as **DepCart: Send Feedback or Request a Feature** in the Command Palette.
- New contributing guide and issue templates, so it's easy to report bugs, ask for registries and send pull requests.
- The Marketplace page now shows an animated demo.

## 0.0.1 (2026-09-26)

First release.

- Search ten package registries from one VS Code sidebar: npm, PyPI, Go modules, crates.io, Maven Central, NuGet, RubyGems, Packagist, pub.dev and Hex.
- Results grouped by language with registry logos. The language with an exact name match comes first, then the languages your project uses.
- Click a package name to open its page on the official registry website (VS Code asks before opening external sites).
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
- A small "Developed by Darshan Jain" bar at the bottom of the sidebar links to the developer's LinkedIn profile.
