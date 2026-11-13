## 4. Amendments to the Blueprint (mandatory)

These close gaps and ambiguities found after the Blueprint was written. Where an amendment conflicts with the Blueprint text, **the amendment wins**.

### AM-01 `types.ts` is type-only; functions live in their own modules

Blueprint §7.1 shows `declare function …` signatures inside `types.ts` for readability. In code, `src/core/types.ts` contains **only** types, interfaces and brands. Implement the functions in the modules named in Blueprint §5.1: `resolveTimestamp` and `localOffsetMinutesAt` in `timestamp.ts`; `pickTimeInWindow` in `jitter.ts`; `normalizeMessage` in `message.ts`; `validateGitPath` and `toPosixRoot` in `path.ts`; `QUOTE_RULES` in `quote.ts`; `renderShell` in `shellRender.ts`; `buildExecPlan` in `execPlan.ts`. Signatures and semantics must match §7.1 exactly.

### AM-02 Shared snapshot types are defined in `core`

`plan.ts` (AM-03) needs `ChangedFile`, `FileChangeKind`, `HeadState`, `Blocker` in `core`, and `core` may not import `shared`. Define these four in `src/core/types.ts` with the exact shapes in Blueprint §7.2, and **re-export** them from `src/shared/protocol.ts` (`export type { … } from "../core/types"`). Do not duplicate definitions.

### AM-03 New module `src/core/plan.ts` (single plan factory used by host and webview)

Host and webview must derive the identical `CommitPlan`. Implement:

```ts
export interface PlanInput {
  readonly repoRoot: string;
  readonly head: HeadState;
  readonly remotes: readonly string[];
  readonly blockers: readonly Blocker[];
  readonly files: readonly ChangedFile[];      // the snapshot's file list
  readonly selectedPaths: readonly string[];   // from the draft
  readonly message: { readonly subject: string; readonly body: string };
  readonly when: { readonly local: LocalDateTime; readonly offsetMinutes: number };
  readonly push: { readonly enabled: boolean; readonly remote: string };
}

export type PlanErrorCode =
  | "BLOCKED" | "PATH_REJECTED" | "STALE_SELECTION"
  | "MESSAGE_REJECTED" | "DATE_REJECTED" | "NOTHING_TO_COMMIT";

export interface PlanError {
  readonly code: PlanErrorCode;
  readonly detail: string;                 // human-readable, no user-controlled markup
  readonly paths?: readonly string[];      // e.g. extra staged files (unborn case)
}

export function buildCommitPlan(input: PlanInput): Result<CommitPlan, PlanError>;
```

Algorithm (in this order; first failure returns):

1. `blockers.length > 0` → `BLOCKED`.
2. `normalizeMessage` fails → `MESSAGE_REJECTED`.
3. `resolveTimestamp` fails → `DATE_REJECTED`.
4. `selectedPaths` empty → `NOTHING_TO_COMMIT` ("No files selected").
5. For each selected path: `validateGitPath` fails → `PATH_REJECTED`; dedupe; the path must equal some `files[i].path`, else `STALE_SELECTION`.
6. `paths` = selected paths, plus `oldPath` (validated) of every selected renamed file. `untrackedPaths` = selected files whose `kind === "untracked"` (new path only).
7. `strategy` = `head.kind === "unborn" ? "index" : "only"`. If `index`: let `extras` = files with `staged === true` whose `path` and `oldPath` are not in `paths`; if non-empty → `BLOCKED` with `paths: extras`.
8. If `push.enabled`: `head.kind === "detached"` → `BLOCKED` ("Push is unavailable on a detached HEAD"). `push.remote` must match `/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/`, be ≤ 255 chars, and be a member of `remotes`, else `BLOCKED`. `branch` = `head.name` (branch) or `head.branch` (unborn). `setUpstream` = `head.kind === "unborn" || head.upstream === undefined`.
9. Return the `CommitPlan` (`repoRoot` unchanged; conversion to POSIX form happens only in `renderShell`).

A compile-time check (`satisfies`) must assert `PlanErrorCode` is a subset of the protocol's `ErrorCode`.

### AM-04 New module `src/core/warnings.ts` (non-blocking warnings, shared)

```ts
export type PlanWarning =
  | "FUTURE_DATE" | "BEFORE_PARENT" | "SUBJECT_OVER_72"
  | "BEHIND_UPSTREAM" | "DETACHED_HEAD" | "PARTIALLY_STAGED";

export function planWarnings(args: {
  readonly plan: CommitPlan;
  readonly head: HeadState;
  readonly files: readonly ChangedFile[];
  readonly headCommitEpochSeconds: number | undefined;
  readonly nowEpochSeconds: number;      // injected; core never reads the clock
}): readonly PlanWarning[];
```

Rules: `FUTURE_DATE` if `timestamp.epochSeconds > now + 300`; `BEFORE_PARENT` if `headCommitEpochSeconds !== undefined && epochSeconds < headCommitEpochSeconds`; `SUBJECT_OVER_72` if `paragraphs[0].length > 72`; `BEHIND_UPSTREAM` if `head.kind === "branch" && head.behind > 0 && plan.push`; `DETACHED_HEAD` if `head.kind === "detached"`; `PARTIALLY_STAGED` if any selected file has `staged && unstaged`.

### AM-05 Protocol amendments

Apply to `src/shared/protocol.ts` and update all uses:

1. `RepoSnapshot` gains `readonly repoRoot: string;` (absolute path). The webview needs it to render a preview identical to Copy.
2. `HostEnv` gains `readonly includeRepoDirInCopy: boolean;` (false only when the detected shell is WSL-style, see AM-12).
3. `HostEnv` also gains `readonly sendToTerminalAvailable: boolean;` computed as: `detectedShell !== "unsupported"` AND the effective shell for the draft equals `detectedShell` (the webview recomputes this per draft; the host enforces it, see AM-11).

### AM-06 Message handling semantics (closes blueprint silence)

| Message | Host behaviour |
|---|---|
| `ready` | If `protocolVersion !== PROTOCOL_VERSION`, show an error banner and stop. Otherwise reply `init`. If a `pendingPreselect` exists, send `snapshot` for that repo then `preselect`. |
| `selectRepo` | Validate `repoId` exists. Set it active. Reply `snapshot`. |
| `initRepository` | Execute the built-in command `git.init`; await the next `onDidOpenRepository`; then re-send `init`. |
| `copy` | Build plan from a **fresh** snapshot (AM-03). Render with `includeRepoDir = env.includeRepoDirInCopy`. Write the string via `vscode.env.clipboard.writeText`. Reply `result {ok:true, action:"copy"}`. |
| `sendToTerminal` | As `copy` but `includeRepoDir = false`; enforce AM-11; send through the terminal service. |
| `run` | Build plan; run `runner.executePlan` under the per-repo mutex; stream `progress`; reply `result`. |
| `cancel` | Only effective while the request is **queued behind the mutex or in pre-flight** → result `CANCELLED`. Once `add` or `commit` has started, `cancel` is ignored (a commit cannot be safely aborted). The UI hides Cancel from the moment `commit` starts. |

Freshness rule: the host never trusts the cached snapshot for execution. It builds a new snapshot immediately before planning; `draft.revision` is advisory only (log mismatches, do not reject on revision alone).

Failure display: errors are shown inline in the webview. If the view is hidden when the action finishes, additionally call `vscode.window.showErrorMessage` with the sanitized message. Success: `showInformationMessage("Committed <shortSha> at <iso>", "Copy SHA")`.

### AM-07 Identity placeholders vs. tooling; single source of IDs

The Blueprint uses `<project-slug>`, `<publisher-id>`, `<extension-id>`, `<display-name>`, `<license>`. Handling:

1. Keep the tokens **verbatim** in `package.json` and docs, **unless** a tool rejects them (npm, vsce, VS Code). Test this in Phase 0.
2. If a tool rejects a token, use these neutral working values and nothing else: slug/extension-id `dev-extension`, publisher `dev-publisher`, display name `Dev Display Name`, license `UNLICENSED`. Record the exact find/replace map in `docs/identity.md` so the owner can swap them in one pass. Never use a product-sounding name.
3. Create `src/host/ids.ts` exporting every command ID, the view ID, every configuration key and the output-channel name as constants derived from one `EXTENSION_ID` constant. All host code references `ids.ts`; no string literal duplicates of IDs anywhere else.
4. Add a unit test `test/unit/manifest.test.ts` asserting: every `contributes.commands[].command`, `views.scm[].id`, and `configuration.properties` key in `package.json` equals the value produced by `ids.ts`; every command in the manifest is registered in `extension.ts` (parse by exported list `REGISTERED_COMMANDS` from `ids.ts`); no other `contributes` keys exist.

### AM-08 Two TypeScript projects (host/core vs. webview)

- `tsconfig.json`: includes `src/core`, `src/shared`, `src/host`, `test/unit`, `test/shell-matrix`; `lib: ["ES2022"]`; `types: ["node"]`; **no DOM lib**; `target: "ES2022"`; module resolution `bundler`; Blueprint §0.3 strict flags.
- `tsconfig.webview.json`: includes `src/webview`, `src/core`, `src/shared`; `lib: ["ES2022","DOM","DOM.Iterable"]`; `types: []`; `jsx: "react-jsx"`, `jsxImportSource: "preact"`.
- `tsconfig.integration.json`: includes `test/integration`; outputs to `out/`.
- `npm run typecheck` runs the first two with `--noEmit`.
- `esbuild`: host bundle target `node20`, format `cjs`, `external: ["vscode"]`; webview bundle target `es2022`, format `iife`, loader for `.css` and codicon font copied to `dist/webview/`.

### AM-09 ESLint flat config (replaces `.eslintrc.cjs`)

Use `eslint.config.mjs` (ESLint 9 flat config) with `typescript-eslint`. Implement Blueprint §5.2 as:

- `src/core/**`: `no-restricted-imports` blocking `vscode`, `node:*`, any bare Node built-in, and any path outside `src/core`; `no-restricted-globals` for `process`, `Buffer`, `window`, `document`, `navigator`, `setTimeout`, `setInterval`, `fetch`.
- `src/webview/**`: allow imports only from `preact`, `preact/hooks`, `@vscode/codicons` (asset), relative `src/core`, `src/shared`, and relative webview files.
- All files except `src/host/runner.ts`: restrict `child_process` / `node:child_process`.
- All files except `src/host/terminal.ts`: `no-restricted-syntax` selector `CallExpression[callee.property.name='sendText']`.
- `src/webview/**`: `no-restricted-syntax` selectors for `AssignmentExpression[left.property.name='innerHTML']`, `AssignmentExpression[left.property.name='outerHTML']`, `JSXAttribute[name.name='dangerouslySetInnerHTML']`, `CallExpression[callee.name='eval']`, `NewExpression[callee.name='Function']`, `JSXAttribute[name.name='style']`.
- Add a test (`test/unit/lint-fitness.test.ts`) that lints small in-memory violating snippets with the ESLint Node API and asserts each rule fires.

### AM-10 Never import runtime values from the vendored `git.d.ts`

`git.d.ts` declares `const enum`s (`Status`, etc.). They do not exist at runtime and esbuild cannot inline them from a `.d.ts`. Therefore:

1. Import **types only** from `src/host/vendor/git.d.ts` (`import type`).
2. Create `src/host/gitStatus.ts` exporting a plain `as const` object mapping every `Status` member name to its numeric value, plus the string constants used for `gitErrorCode` comparisons.
3. **Do not type the numbers from memory.** Generate them by parsing the vendored `git.d.ts` (script or one-time derivation) and add `test/unit/gitStatus.test.ts` which reads the vendored `.d.ts` text and asserts the object equals the declared enum, member by member and value by value.

### AM-11 Send to Terminal only when dialects match

The dedicated terminal runs the user's **default profile shell**. If the effective shell (draft override, else the `shell` setting, else detected) differs from `detectedShell`, or `detectedShell === "unsupported"`:

- the webview disables **Send to Terminal** with the tooltip "Shell override applies to Copy only";
- the host independently rejects `sendToTerminal` with `UNSUPPORTED_SHELL` and a message naming both shells.

Copy remains available for any selected dialect.

### AM-12 Shell detection mapping (`src/host/shell.ts`)

`detectShell(shellPath: string): { kind: DetectedShell; wslStyle: boolean }`. Take the basename of `vscode.env.shell`, lowercase, strip a trailing `.exe`.

| Basename | Result |
|---|---|
| `bash`, `git-bash` | `bash` |
| `zsh` | `zsh` |
| `fish` | `fish` |
| `sh`, `dash`, `ash` | `sh` |
| `pwsh` | `pwsh` |
| `powershell` | `powershell` |
| `cmd` | `cmd` |
| `wsl` | `bash` with `wslStyle: true` |
| anything else, including empty string | `unsupported` |

`includeRepoDirInCopy = !wslStyle`. Unit-test the full table, including Windows-style paths (`C:\Windows\System32\cmd.exe`) and POSIX paths.

### AM-13 Rollback set

In **both** strategies, `ExecPlan.rollback` operates on `plan.untrackedPaths` only, never on `plan.paths`. (`git rm --cached` on a tracked path would stage a deletion.) No rollback step exists when `untrackedPaths` is empty. Test: a pre-staged tracked file is untouched after a failed commit in both strategies.

### AM-14 Canonical cmd.exe chain

The cmd render wraps the **entire** chain, including the `add` and `push` units, in one parenthesized group, followed by unconditional cleanup:

```text
(ADD && set "GIT_AUTHOR_DATE=D" && set "GIT_COMMITTER_DATE=D" && COMMIT && PUSH) & set "GIT_AUTHOR_DATE=" & set "GIT_COMMITTER_DATE="
```

Omit `ADD` and `PUSH` and their `&&` when absent. `D` contains no cmd-special characters (only digits, `-`, `T`, `:`, `+`).

### AM-15 Canary design for injection tests

Use a payload that works in every shell: **`git config canary.hit 1`** (writes to the fixture repo's local config) instead of `touch`. A test case fails if either `git config --get canary.hit` returns anything **or** a file named `canary` exists in the fixture. Every §13.1 vector in the Blueprint that contains `touch canary` uses this payload instead; vectors with redirection (`a > canary`) additionally check that no file `canary` exists.

### AM-16 Default draft values (webview)

On first load per repo: date and time = the current local date/time (seconds included); `offsetMinutes` = `localOffsetMinutesAt(now)`, offset mode `local`; empty subject and body; `paths` = preselected paths or empty; `push.enabled` = `env.pushDefaultEnabled`; `push.remote` = the remote whose name followed by `/` is the longest prefix of `head.upstream`, else `origin` if present in `remotes`, else the first remote, else `""` (and the push control is disabled when `remotes` is empty).

### AM-17 Extra spike S7 (argument shapes of context-menu commands)

Add spike **S7**: record the exact runtime argument shapes passed to a command contributed to `explorer/context` (file, folder, multi-select), `scm/resourceState/context` (single and multiple selection) and `scm/resourceFolder/context`. `resourceResolver.ts` must implement exactly what S7 observes, ignore unknown shapes safely (no preselection, no throw), and have unit tests built from recorded fixtures of those shapes.

### AM-18 Test runner details that were unspecified

- Shell-matrix spawn forms: `bash -c`, `sh -c`, `zsh -c`, `fish -c`, `pwsh -NoProfile -NonInteractive -Command`, `powershell.exe -NoProfile -NonInteractive -Command`; cmd: `spawn("cmd.exe", ["/d","/s","/c", `"${line}"`], { windowsVerbatimArguments: true })`. Vector 10 (`!!` history expansion) must additionally run with `bash -i -c` and `zsh -i -c`; if interactive invocation is impossible in CI, mark that single cell **UNVERIFIED** rather than skipping silently.
- Each (shell × vector) case uses a **fresh temp repo** with `git init`, a local `user.name`/`user.email`, one initial commit, and one modified tracked file.
- Round-trip expectation: `git log -1 --format=%B` with trailing whitespace trimmed equals `paragraphs.join("\n\n")`.
- Date expectation: `git log -1 --format=%ad%x7c%cd --date=raw` shows `<epoch> <±HHMM>` for both fields equal to `GitTimestamp`.
- File-name vectors containing `*`, `:`, `"`, `<`, `>`, `?`, `|` are skipped on Windows (the filesystem forbids them) and the skip is logged.
- Integration tests run on the **minimum supported VS Code (`1.90.0`)** and `stable` (`.vscode-test.mjs` defines both); fixtures are created programmatically with the git CLI at test time, never committed.

---
