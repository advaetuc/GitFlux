# GitFlux Project Context & Architectural Handoff

> **Last Updated:** November 2026  
> **Extension ID:** `advaetuc.gitflux`  
> **Version:** `0.1.0` (Production Release)  
> **Marketplace:** [https://marketplace.visualstudio.com/items?itemName=advaetuc.gitflux](https://marketplace.visualstudio.com/items?itemName=advaetuc.gitflux)  
> **Repository:** [https://github.com/advaetuc/GitFlux](https://github.com/advaetuc/GitFlux)

---

## 1. Project Overview & Release Status

GitFlux is a high-reliability, zero-runtime-dependency VS Code extension that enables developers to selectively stage files and commit them with custom author and committer dates without altering or committing other staged changes in the Git index.

- **Current State:** v0.1.0 published on the Visual Studio Marketplace.
- **CI / Matrix Health:** 100% green workflows across Ubuntu Linux, macOS, and Windows.
- **Test Metrics:** 339 passed unit & fixture tests; 90 passed shell-matrix hostile vector tests.
- **Coverage:** **99.33%** line coverage across `src/core/**` (enforced minimum: 95%).
- **Bundle Footprint:** `dist/extension.js` (~40 KB), `dist/webview/main.js` (~40 KB, 14.1 KB gzipped).
- **Runtime Dependencies:** Zero (`dependencies: {}`).

---

## 2. Completed Phases Inventory (Phases 0–5)

### Phase 0: Foundations & Capability Probe
- Established Node 20 / TypeScript 5.6.3 / Vitest 2.1.3 development toolchain.
- Executed and validated Spikes S1–S5 in `docs/spikes.md`:
  - **S1:** Git CLI flags and `commit --only` semantics with stdin NUL pathspecs.
  - **S2:** Unborn branch handling and fallback strategies.
  - **S3:** VS Code Git API integration and resource state mapping.
  - **S4:** Webview panel integration in `views.scm`.
  - **S5:** Shell quoting and escaping across POSIX and Windows shells.

### Phase 1: Pure Core Domain (`src/core/`)
- Built pure, isolated modules with zero VS Code and zero Node.js built-in dependencies:
  - `plan.ts`: Preflight verification, repository lock checks, blocker resolution (merge/rebase in progress, detached HEAD, empty commit messages).
  - `execPlan.ts`: Atomic execution recipes for `add`, `commit`, `verify`, and `rollback`.
  - `shellRender.ts`: Deterministic, single-line preview generation for Copy and Send to Terminal.
  - `quote.ts`: Dialect-specific escaping engines across 7 shells (`bash`, `zsh`, `sh`, `fish`, `pwsh`, `powershell`, `cmd`).
  - `timestamp.ts`: Full ISO 8601 parsing, second-level accuracy, and fixed/local timezone offset calculations.
  - `jitter.ts`: Seeded/uniform randomized timestamp generator within working hours (`09:30`–`18:30`).
  - `warnings.ts`: Non-blocking user advisories for timezone drift, weekends, and future timestamps.

### Phase 2: Host Infrastructure (`src/host/`)
- Integrated with VS Code Extension Host environment:
  - `gitApi.ts`: Safe wrapper around `vscode.git` API.
  - `resourceResolver.ts`: URI-to-repository mapping for Explorer, SCM Changes list, and multi-selections.
  - `repoState.ts`: State snapshot builder with 250ms per-repository debounce.
  - `panelProvider.ts`: WebviewViewProvider managing two-way handshake, state synchronization, and execution dispatch.
  - `runner.ts`: Git execution gateway using Node `execFile` argument vectors with per-repository mutex locking and automatic `git rm --cached` rollback on pre-commit hook failure.
  - `terminal.ts`: Dedicated integrated terminal manager (`GitFlux: <repo-name>`) with dialect safety verification.

### Phase 3: Preact Webview UI (`src/webview/`)
- Implemented lightweight, accessible UI inside an iframe with strict Content Security Policy (`script-src 'nonce-...'`):
  - `App.tsx`: Root component integrating file selection list, date/time inputs, working hours jitter button, commit message textarea, prefix chips, live command preview, and action buttons.
  - `draftReducer.ts`: Pure reducer providing instant optimistic feedback for user edits before host roundtrip.
  - Styled with VS Code theme CSS variables (`--vscode-*`) and `@vscode/codicons`.

### Phase 4: Integration, Shell Matrix & Hardening
- Implemented 18 hostile attack vectors in `test/shell-matrix/shellMatrix.test.ts` testing quotes, command substitutions, pipe injections, unicode, smart quotes, control characters, and trailing backslashes.
- Supported `REQUIRE_SHELLS` verification for deterministic CI passes.
- Confirmed `vsce package` outputs an allowlisted 11-file VSIX package.

### Phase 5: Optional HEAD Date Amender
- Implemented non-destructive amending of the latest local commit per Blueprint §10 & §14.2:
  - `buildAmendPlan` & `buildAmendExecPlan`: Executes `git commit --amend --only --no-edit --date="..."`.
  - Safety guard: Rejects any attempt to amend a commit that is already published to a remote branch, preventing force-push rewrites.

---

## 3. Canonical Document Index

The repository maintains an authoritative set of markdown records under `docs/`:

| Document | Authority Level | Description |
| :--- | :--- | :--- |
| `docs/blueprint.md` | Primary Architecture (Read-Only) | Technical source of truth. Must **never** be edited directly. |
| `docs/amendments.md` | Ratified Amendments | Overrules blueprint where conflicts exist (AM-01 through AM-18). |
| `docs/deviations.md` | Formal Deviations | Documents deliberate deviations from the initial blueprint. |
| `docs/spikes.md` | Spikes Record | Runtime observation notes from proof-of-concept spikes S1–S5. |
| `docs/identity.md` | Identity Resolution | Identity tokens, publisher configuration, and package metadata. |
| `docs/smoke-test.md` | Verification Script | Detailed manual walkthrough for testing in Extension Development Host. |
| `AGENTS.md` | Operating Manual | Hard rules, Gotchas, and instructions for AI coding agents. |

---

## 4. Completed v0.2.0 Deliverables

- **Milestone A (Honest Positioning & Release Automation):**
  - Honest streak positioning and safety claims sections in `README.md`.
  - Comprehensive behavioral safety claims test suite (`test/unit/safetyClaims.test.ts`).
  - Reusable CI workflow and tag-driven OIDC release automation (`.github/workflows/publish.yml`).
- **Milestone B (Streak-Gap Picker & Readiness Checklist):**
  - Pure 12-week UTC heatmap core (`src/core/heatmap.ts`) and UTC day shift warning (`src/core/warnings.ts`).
  - Read-only Git activity service (`src/host/activity.ts`) with memoized caching.
  - Interactive Preact streak grid (`StreakGrid.tsx`) with zero-JS native `<details>` readiness checklist (`ReadinessChecklist.tsx`).

---

## 5. Prioritized v0.2.1+ Roadmap

For subsequent iterations and feature releases, prioritize work in this order:

1. **Custom Extension Logo / Icon:**
   - Design a crisp 128×128 or 256×256 PNG/SVG logo representing GitFlux (e.g. clock + git commit node).
   - Add `"icon": "resources/icon.png"` in `package.json` and include in `.vscodeignore` allowlist.
2. **Internationalization & Localization (`package.nls.json`):**
   - Extract user-facing string literals from `package.json` and UI components into localization bundles.
