# GitFlux — AI Coding Agent Onboarding Prompt

> **Instructions for the Project Owner:**  
> When starting a new AI coding session (with Antigravity, Claude Code, Codex, Cursor, etc.), copy and paste the block below into your first prompt to immediately establish complete architectural alignment.

---

```markdown
You are an autonomous AI coding agent assigned to work on the GitFlux codebase located at `/Users/advaet/Projects/GitFlux`.

### 1. Identity & Release Coordinates
- **Extension ID:** `advaetuc.gitflux` (v0.2.2 released on the VS Code Marketplace)
- **Repository:** https://github.com/advaetuc/GitFlux
- **License:** MIT (Copyright (c) 2026 Advaet Chintakunta)
- **Engines:** VS Code `^1.90.0`, Node.js 20, Git `>= 2.26.0`

### 2. Immediate Mandatory Reading
Before proposing or making any changes, read these authoritative documents:
1. `AGENTS.md` (Root operating manual, architectural fitness rules, critical gotchas)
2. `docs/AGENT_CONTEXT.md` (Project history, completed phase inventory, canonical document map)
3. `docs/amendments.md` (Ratified amendments AM-01 to AM-18)
4. `docs/blueprint.md` (Technical architecture blueprint — READ-ONLY, NEVER EDIT)

### 3. Strict 4-Layer Architectural Boundaries
GitFlux enforces hard separation between four distinct layers:
1. **Entry Points:** VS Code UI menus (`explorer/context`, `scm/resourceState/context`, Command Palette, and SCM View panel).
2. **Extension Host (Node 20):** (`src/host/`) Manages VS Code APIs, 250ms debounced repository snapshots, webview handshake, and git execution.
3. **Pure Core (Zero-Dep):** (`src/core/`) Pure TypeScript business logic (plan generation, hostile shell quoting, ISO timestamp math, jitter). Must NEVER import `vscode` or Node built-in modules (`fs`, `child_process`, `os`, `path`, etc.). Line coverage must remain ≥ 95%.
4. **Preact Webview (<16 KB):** (`src/webview/`) Sandboxed UI compiled with Preact and Codicons (~15.8 KB gzip / < 60 KB). Must NEVER import `vscode` or use `innerHTML`, `outerHTML`, `eval`, or inline `style` attributes.

### 4. Six Non-Negotiable Engineering Invariants (Do Not Regress!)
1. **Preact JSX Runtime:** `esbuild.mjs` must retain `tsconfig: "tsconfig.webview.json"`, `jsx: "automatic"`, `jsxImportSource: "preact"` so `dist/webview/main.js` never emits `React.createElement`.
2. **CI TypeScript-ESLint:** `eslint.config.mjs` must retain `disallowAutomaticSingleRunInference: true` in `parserOptions`, and `test/unit/lint-fitness.test.ts` must set `process.env.TSESTREE_SINGLE_RUN = "false"` so CI does not lint stale on-disk ASTs during programmatic `eslint.lintText()`.
3. **Windows cmd.exe Trailing Backslashes:** `QUOTE_RULES.cmd.quote` in `src/core/quote.ts` must double trailing backslashes (`val.replace(/(\\+)$/, "$1$1")`) to prevent Windows CRT (`CommandLineToArgvW`) from escaping the closing double-quote.
4. **POSIX Path Normalization:** `normalizeFsPath` in `src/host/repoState.ts` must strip `/private/tmp`, `/private/var`, and `/private/etc` unconditionally across all POSIX systems (not darwin-only).
5. **Webview Handshake & Subscriptions:** `CommitPanelProvider` in `src/host/panelProvider.ts` must queue `pendingPreselect` until the webview sends `{ type: "ready" }`, and maintain 250ms debounced subscriptions on `repo.state.onDidChange` and `gitApi.onDidOpenRepository`.
6. **Marketplace PNG Banners:** `README.md` must reference `.png` renders of SVG assets (at exact 2x `viewBox` dimensions rendered via `@resvg/resvg-js`) because the VS Code Marketplace rejects non-badge SVGs.

### 5. Verification Checklist
Before completing your task, run the full verification gate:
```bash
npm run build && npm run typecheck && npm run lint && npm run test:coverage && REQUIRE_SHELLS=bash,zsh,sh,fish,pwsh npm run test:shell && npm run package && npx vsce ls
```
Ensure `npx vsce ls` contains strictly the 11 allowlisted distribution files.
```
