# GitFlux — Operating Manual for AI Coding Agents

> **Audience:** This document is the primary onboarding manual and operational guide for any AI coding agent (Antigravity, Claude Code, Codex, Cursor, etc.) working on the GitFlux codebase.
> **Package / Identity:** `gitflux` • Publisher: `advaetuc` • Name: `GitFlux` • License: `MIT`

---

## 1. Repository Overview & Directory Layout

GitFlux is a VS Code extension designed to stage selected changed files and commit them with custom author/committer dates without touching unrelated staged changes.

```
GitFlux/
├── .github/workflows/ci.yml       # Multi-platform CI (Ubuntu, macOS, Windows)
├── .vscode/                       # Launch configs & settings for F5 Extension Host debugging
├── docs/
│   ├── assets/                    # Technical SVG diagrams & 2x PNG Marketplace renders (hero, arch, pipeline)
│   ├── blueprint.md               # Finalized Technical Architecture Blueprint (READ-ONLY)
│   ├── amendments.md              # Ratified architectural amendments (AM-01 through AM-18)
│   ├── deviations.md              # Formal deviation register (if any)
│   ├── environment.md             # Development environment probe output
│   ├── identity.md                # Identity resolution & publication manifest
│   ├── smoke-test.md              # Interactive smoke test procedure
│   └── spikes.md                  # Prototype spikes (S1–S5) verification record
├── src/
│   ├── core/                      # Pure TypeScript business logic (Zero-dependency sandbox)
│   │   ├── execPlan.ts            # Execution recipes (Add, Commit, Raw Verify, Rollback)
│   │   ├── heatmap.ts             # 12-week UTC contribution heatmap & day bucketing
│   │   ├── jitter.ts              # Uniform random timestamp generation in working hours
│   │   ├── message.ts             # Conventional commit prefix chips & message validation
│   │   ├── path.ts                # Cross-platform path normalization & comparisons
│   │   ├── plan.ts                # Preflight validation, blockers, and plan construction
│   │   ├── quote.ts               # Hostile vector escaping across 7 shell dialects
│   │   ├── shellRender.ts         # Single-line preview generator for Copy / Terminal
│   │   ├── timestamp.ts           # ISO 8601, epoch conversion, and offset resolution
│   │   ├── types.ts               # Core domain types & interfaces
│   │   └── warnings.ts            # Non-blocking user advisories & UTC day shift alerts
│   ├── host/                      # Extension host integration (Node 20 / VS Code API)
│   │   ├── activity.ts            # Author commit activity reader & memory cache
│   │   ├── extension.ts           # Extension activation, command registration & disposal
│   │   ├── gitApi.ts              # vscode.git API integration & repository discovery
│   │   ├── ids.ts                 # Constant identifiers (EXTENSION_ID, VIEW_ID, commands)
│   │   ├── panelProvider.ts       # WebviewViewProvider, state sync & message dispatch
│   │   ├── repoState.ts           # Repository snapshot builder & 250ms debouncer
│   │   ├── resourceResolver.ts    # SCM / Explorer URI to repository mapping
│   │   ├── runner.ts              # Git execution gateway (execFile, mutex, rollback)
│   │   └── terminal.ts            # Dedicated terminal management (sendText isolation)
│   ├── shared/                    # Shared types & IPC protocol (bidirectional contracts)
│   │   └── protocol.ts            # HostToWebviewMessage & WebviewToHostMessage
│   └── webview/                   # Preact Webview UI (<16 KB gzip bundle)
│       ├── components/            # UI components (ActionBar, StreakGrid, ReadinessChecklist, etc.)
│       ├── App.tsx                # Top-level Preact application component
│       ├── draftReducer.ts        # Pure reducer managing optimistic webview state
│       ├── main.tsx               # Webview DOM entry point & hydration
│       └── vscodeApi.ts           # acquireVsCodeApi() wrapper
├── test/
│   ├── fixtures/                  # Real Git CLI fixture tests & sample repositories
│   ├── integration/               # vscode-test integration test suite
│   ├── shell-matrix/              # 18 hostile vector tests across 7 shell dialects
│   └── unit/                      # Fast Vitest unit tests for Core, Host, and Webview
├── esbuild.mjs                    # Bundler config for host extension and Preact webview
├── eslint.config.mjs              # Flat config enforcing AM-09 architectural fitness rules
├── package.json                   # Manifest with zero runtime dependencies
├── tsconfig.json                  # Extension host & unit test TypeScript config
├── tsconfig.webview.json          # Preact webview TypeScript config
└── vitest.config.ts               # Vitest runner config with v8 coverage thresholds
```

---

## 2. Standard Build, Test & Packaging Commands

Always use these exact scripts. Do not introduce alternative build steps:

| Command | Purpose | Success Criteria |
| :--- | :--- | :--- |
| `npm run build` | Compiles extension and webview via `esbuild.mjs` | Generates `dist/extension.js` and `dist/webview/main.js` |
| `npm run typecheck` | Validates TypeScript across Host, Webview, and Tests | Zero type errors across all tsconfigs |
| `npm run lint` | Runs ESLint 9 flat config across `src/` and `test/` | Zero warnings and zero errors (`--max-warnings 0`) |
| `npm test` | Runs full Vitest unit and fixture test suite | All 26 test files pass (537+ tests) |
| `npm run test:coverage` | Runs unit tests with v8 code coverage | `src/core/**` line coverage **≥ 95%** (currently 99.40%) |
| `REQUIRE_SHELLS=bash,zsh,sh,fish,pwsh npm run test:shell` | Runs 18 hostile vectors on installed shells | 90 passed, 36 skipped on macOS/Linux |
| `npm run package` | Builds and packages into production `.vsix` | Generates `gitflux-0.2.2.vsix` without git tags |
| `npx vsce ls` | Lists all files that will be packaged into the VSIX | Exactly **11 files** (manifest, license, readme, dist) |

---

## 3. The 6 Non-Negotiable Architecture Fitness Rules

Enforced automatically by `eslint.config.mjs` and tested by `test/unit/lint-fitness.test.ts`. Any commit violating these rules will break CI:

1. **Pure Core Isolation (`src/core/**`):**
   - Must **NEVER** import `"vscode"`.
   - Core domain logic must remain completely decoupled from VS Code APIs to allow pure unit testing without Electron or mocking harnesses.
2. **No Node Built-ins in Core (`src/core/**`):**
   - Must **NEVER** import Node.js built-ins (`fs`, `child_process`, `os`, `path`, etc.) or prefixed `node:*`.
   - Use `src/core/path.ts` for POSIX path normalization.
3. **Webview VS Code Isolation (`src/webview/**`):**
   - Must **NEVER** import `"vscode"`.
   - Webview runs inside an isolated iframe and communicates strictly with the extension host via typed messages using `getVsCodeApi().postMessage()`.
4. **Child Process Gateway Isolation (`runner.ts`):**
   - `child_process` and `node:child_process` may **ONLY** be imported in `src/host/runner.ts`.
   - No other host file or core module is permitted to execute system processes.
5. **Terminal `sendText` Isolation (`terminal.ts`):**
   - `sendText` may **ONLY** be called in `src/host/terminal.ts`.
   - Direct execution must use `runner.ts` (`execFile`), while clipboard and terminal output are strictly separated.
6. **Webview AST Security & CSP:**
   - Webview code must **NEVER** use `innerHTML`, `outerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, or inline `style` attributes.
   - Styling must strictly use CSS classes or VS Code theme CSS variables.

---

## 4. The 6 Critical Engineering Gotchas

These six issues required deep architectural troubleshooting during v0.1.0–v0.2.2 development. **Do not modify or refactor these patterns without reading this section:**

### Gotcha 1: `esbuild.mjs` Preact JSX Runtime
- **The Issue:** If `webviewOptions` in `esbuild.mjs` omits explicit JSX configuration, esbuild defaults to standard React and emits `React.createElement(...)`. In the webview, `React` is not imported, throwing `ReferenceError: React is not defined` at runtime.
- **The Invariant:** `webviewOptions` in `esbuild.mjs` must always specify:
  ```javascript
  tsconfig: "tsconfig.webview.json",
  jsx: "automatic",
  jsxImportSource: "preact",
  ```
  Verified by `test/unit/phase3Gate.test.ts` checking that `dist/webview/main.js` never contains `"React.createElement"`.

### Gotcha 2: `@typescript-eslint` Single-Run Inference in CI
- **The Issue:** In GitHub Actions (`CI=true`), `@typescript-eslint` automatically infers `singleRun: true`. Under single-run mode, on the initial parse of any file path, `@typescript-eslint` pulls the AST directly from disk rather than the in-memory string passed to `eslint.lintText()`. This causes programmatic tests in `test/unit/lint-fitness.test.ts` to evaluate the clean on-disk file and return `got: []` (zero messages).
- **The Invariant:**
  - `eslint.config.mjs` must specify `disallowAutomaticSingleRunInference: true` inside `languageOptions.parserOptions`.
  - `test/unit/lint-fitness.test.ts` must explicitly set `process.env.TSESTREE_SINGLE_RUN = "false"` and instantiate `new ESLint` with explicit `cwd: projectRoot` and `overrideConfigFile`.

### Gotcha 3: Windows `cmd.exe` Trailing Backslash Quoting
- **The Issue:** In Windows `cmd.exe`, passing `-m "trailing\" -- "file.txt"` causes the Windows C-Runtime (`CommandLineToArgvW`) to interpret the `\"` as an escaped double quote rather than the end of the argument. This swallows the subsequent `-- "file.txt"` argument into the commit message.
- **The Invariant:** In `src/core/quote.ts`, `QUOTE_RULES.cmd.quote` must double any trailing backslashes immediately preceding the closing double-quote:
  ```typescript
  quote: (value: string) => `"${value.replace(/(\\+)$/, "$1$1")}"`
  ```
  `QUOTE_RULES.cmd.quote("trailing\\")` must return `"\"trailing\\\\\""`. Verified by `test/unit/quote.test.ts`.

### Gotcha 4: POSIX `/private/tmp` Path Normalization
- **The Issue:** On macOS, `/tmp` is a symlink to `/private/tmp`. If `repoState.ts` or `resourceResolver.ts` only strips `/private/` on `process.platform === "darwin"`, POSIX paths on Linux test runners or Docker containers can mismatch.
- **The Invariant:** `normalizeFsPath` in `src/host/repoState.ts` must unconditionally strip `/private/tmp/`, `/private/var/`, and `/private/etc/` across all platforms:
  ```typescript
  if (norm === "/private/tmp" || norm.startsWith("/private/tmp/")) {
    norm = norm.slice(8);
  } else if (norm === "/private/var" || norm.startsWith("/private/var/")) {
    norm = norm.slice(8);
  } else if (norm === "/private/etc" || norm.startsWith("/private/etc/")) {
    norm = norm.slice(8);
  }
  ```

### Gotcha 5: Webview Handshake & Event Subscriptions
- **The Issue:** If a user selects files in the Explorer before the SCM webview has rendered, posting an IPC message immediately will drop the preselected files because the webview listener is not yet attached. Furthermore, if `vscode.git` repository state events are not subscribed to, committing files won't refresh the UI list.
- **The Invariant:**
  - `CommitPanelProvider` in `src/host/panelProvider.ts` must queue `pendingPreselect` until the webview sends `{ type: "ready" }`.
  - The provider must maintain debounced (250ms) listeners on `repo.state.onDidChange`, `gitApi.onDidChangeState`, and `gitApi.onDidOpenRepository`.

### Gotcha 6: VS Code Marketplace SVG Restriction in `README.md`
- **The Issue:** The Visual Studio Code Marketplace sanitizes and rejects non-badge SVGs in extension `README.md` files for security reasons, causing broken image placeholders on marketplace item pages.
- **The Invariant:** `README.md` must reference `.png` (not `.svg`) for custom banners and diagrams (`hero-banner.png`, `architecture-flow.png`, `execution-pipeline.png`). PNG renders must be generated from source SVGs at exact 2x `viewBox` aspect ratio (`1760×440`, `1760×480`, `1760×640`) via `@resvg/resvg-js` (never `qlmanage -t`, which forces a square 1:1 canvas with white padding).

---

## 5. Agent Verification Checklist Before Ending Any Turn

Whenever you modify any code in this repository, run this exact sequence before declaring completion:

1. `npm run build` — Bundles output clean.
2. `npm run typecheck` — TypeScript compiles without errors.
3. `npm run lint` — ESLint reports 0 warnings and 0 errors.
4. `CI=true npm test` — All unit tests pass in CI simulation.
5. `npm run test:coverage` — Core coverage remains ≥ 95%.
6. `npx vsce ls` — Package file list contains only the 11 allowlisted files.
