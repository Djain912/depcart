# Contributing to DepCart

Thanks for helping make DepCart better. Every kind of help counts: a bug report, an idea, a typo fix, a new install tool or a whole new registry.

## Give feedback

- **Found a bug?** [Open a bug report](https://github.com/Djain912/depcart/issues/new?template=bug_report.yml). Include your VS Code version, OS, the registry, and what you searched for.
- **Have an idea?** [Suggest a feature](https://github.com/Djain912/depcart/issues/new?template=feature_request.yml).
- **Want another registry or tool?** [Request it](https://github.com/Djain912/depcart/issues/new?template=registry_request.yml), for example CocoaPods, Conan, vcpkg, Hackage, CRAN or Julia's General registry.
- **Like it?** A star on GitHub or a rating on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=djain912.depcart&ssr=false#review-details) helps other developers find it.

Inside VS Code, the **Feedback** link at the bottom of the DepCart sidebar (or the feedback button in its title bar) takes you straight to these forms.

## Set up

You need Node.js 22 or newer and VS Code 1.90 or newer.

```bash
git clone https://github.com/Djain912/depcart.git
cd depcart
npm install
npm test            # unit tests
npm run test:host   # runs the extension inside a real VS Code against the live registries
```

Press **F5** in VS Code to open an Extension Development Host with your changes loaded.

## Where things live

| Path | What it does |
|---|---|
| `src/registries/*.ts` | One file per registry: search, versions, install tools, name and version patterns |
| `src/registries/index.ts` | The list and display order of registries |
| `src/detect.ts` | Picks the install tool from project files (lockfiles and config) |
| `src/commandBuilder.ts` | Turns the selection into one command per language |
| `src/search.ts` | Hedged search with the ecosyste.ms backup index and deadlines |
| `src/pickerViewProvider.ts` | The sidebar's extension side: messages, validation, terminals |
| `media/main.js`, `media/main.css` | The sidebar UI (a webview) |
| `src/test/` | Unit tests (`node --test`) |
| `src/test-integration/` | Checks that run inside a real VS Code |
| `docs/` | The website at djain912.github.io/depcart |

## Good first contributions

- Add an install tool to an existing registry (for example `rye` for Python or `vlt` for npm): add an `InstallTool` to the registry's `tools` with its `markers`, then a case in `src/test/tools.test.ts`.
- Improve search ranking for a registry and add a test in `src/test/search.test.ts`.
- Improve the sidebar's accessibility or keyboard navigation.
- Fix wording in the README or on the website.

Issues labelled [`good first issue`](https://github.com/Djain912/depcart/labels/good%20first%20issue) are a good place to start.

## Adding a registry

1. Create `src/registries/<name>.ts` that exports a `Registry` (see `src/registries/types.ts`). Look at `crates.ts` for a small example.
2. Validate names and versions with strict `namePattern` and `versionPattern`. Commands must never contain shell syntax from a package name.
3. Add it to `src/registries/index.ts`, add its logo to `media/registryIcons.js`, and add searches to `SEARCHES` in `src/test-integration/index.ts`.
4. Add unit tests for its tools and page URL.

## Pull requests

- Keep each PR focused on one change and describe what you tested.
- Run `npm test` before you push. CI runs the unit tests on Windows, macOS and Linux and the host checks on Linux.
- Match the style of the code around your change.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).

## Be kind

Be respectful and assume good intent. Harassment or abuse of any kind isn't welcome here.

Questions? Open an issue, or reach the maintainer on [LinkedIn](https://linkedin.com/in/darshanjain912).
