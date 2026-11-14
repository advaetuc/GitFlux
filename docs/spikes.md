# Spikes Log

This document records the empirical results of all spikes defined in Blueprint §2, Blueprint §5, and Master Prompt §4–§5.

---

## S1: Git CLI Flags and `commit --only` Semantics

- **Goal:** Verify that `git --literal-pathspecs commit --only --pathspec-from-file=- --pathspec-file-nul -m …` commits exactly the listed tracked paths (modified, deleted, renamed) and leaves other staged changes staged. Also verify `add`, `rm --cached`, and raw date format.
- **Environment:** macOS 27.2.1, git version 2.54.0 (Apple Git-157). (Git 2.26.0 locally UNVERIFIED; deferred to CI).
- **Script:** `docs/spikes/s1.sh`
- **Output Excerpt:**
  ```text
  --- Pre-commit git status ---
   M a.txt
  M  b.txt
   D delete_me.txt
  R  rename_me.txt -> renamed.txt
  ?? untracked.txt
  Untracked added via stdin pathspecs.
  [main 7f7f03a] spike commit
   4 files changed, 2 insertions(+), 2 deletions(-)
   delete mode 100644 delete_me.txt
   rename rename_me.txt => renamed.txt (100%)
   create mode 100644 untracked.txt
  --- Post-commit git status ---
  M  b.txt
  PASS: pre-staged b.txt remained staged: M  b.txt
  Commit verify raw: 7f7f03a3a9358b252a7a2c6b0e5880d9ddf8b8521772428267 +05301772428267 +0530
  Author raw date: 1772428267 +0530
  Committer raw date: 1772428267 +0530
  PASS: Date offset +0530 recorded correctly in author and committer
  Added to_rollback.txt to index
  Rolled back to_rollback.txt
  PASS: to_rollback.txt is untracked again after rollback: ?? to_rollback.txt
  === Spike S1 SUCCESS ===
  ```
- **Outcome:** **OBSERVED (runtime on Git 2.54.0)**. Untracked files add via stdin nul pathspecs. `commit --only` committed modified, renamed (with both paths listed), deleted, and newly added files while leaving pre-staged `b.txt` in index untouched. Date offset was preserved identically in both author and committer dates. Rollback with `rm --cached` untracked newly added file.

---

## S2: Unborn Branch Behavior

- **Goal:** Test behavior of `commit --only` on an unborn branch vs. `index` strategy.
- **Environment:** macOS 27.2.1, git version 2.54.0.
- **Script:** `docs/spikes/s2.sh`
- **Output Excerpt:**
  ```text
  Testing: commit --only on unborn branch
  error: pathspec 'first.txt' did not match any file(s) known to git
  Exit code for commit --only on unborn branch: 1
  Testing: index strategy on unborn branch
  [main (root-commit) e81a5d3] first commit via index strategy
   1 file changed, 1 insertion(+)
   create mode 100644 first.txt
  Index strategy succeeded on unborn branch.
  ```
- **Outcome:** **OBSERVED (runtime on Git 2.54.0)**. On unborn HEAD, `commit --only` fails with exit code 1 because Git has no prior commit to compare against. The `index` strategy (`git add -- <paths>` followed by `git commit`) is required and succeeds.

---

## S3: `vscode.git` API Behavior

- **Goal:** Verify how `vscode.git` API is acquired, workingTreeChanges / indexChanges include untracked files, Change fields (`uri`, `originalUri`, `renameUri`), submodules identification, and closest-root resolution with nested repos.
- **Source of Truth:** Vendored `src/host/vendor/git.d.ts` copied from `microsoft/vscode` commit `89de5a8d4d6205e5b11647eb6a74844ca23d2573` (release 1.90.0), confirmed at runtime in VS Code Extension Development Host.
- **Findings from API inspection & runtime smoke test:**
  1. Access sequence:
     ```ts
     const gitExt = vscode.extensions.getExtension<GitExtension>("vscode.git");
     if (!gitExt) throw new Error("vscode.git not found");
     const api = (await gitExt.activate()).getAPI(1);
     ```
  2. `Repository.state`:
     - `workingTreeChanges`: includes `Status.UNTRACKED` when untracked changes are enabled (default).
     - `indexChanges`: staged changes.
     - `mergeChanges`: conflicts / unmerged entries.
     - `submodules`: array of submodule objects.
     - `rebaseCommit`: present during interactive rebase.
  3. `Change`:
     - `uri`: resource URI (new path for renames/modifications).
     - `originalUri`: previous URI before rename/deletion.
     - `renameUri`: new destination URI when renamed.
     - `status`: member of `Status` enum.
  4. Repository resolution: `api.getRepository(uri)` searches for repository root containing `uri` (closest-root), with fallback prefix matching normalized for symlinks (`/private/tmp` vs `/tmp`).
  5. Execution semantics: In live F5 testing on `/Users/advaet/Projects/gitflux-smoke-repo`, strategy `only` successfully committed `renamed-new.txt` with custom author and committer dates while leaving unrelated pre-staged `staged.txt` staged in `Staged Changes` without modifying or clearing the index.
- **Outcome:** **OBSERVED (runtime in VS Code Extension Development Host on macOS)**. Verified at runtime on `/Users/advaet/Projects/gitflux-smoke-repo`: `vscode.git` API successfully accessed; `workingTreeChanges` and `indexChanges` correctly reflect modified, staged, untracked, and renamed files; strategy `only` committed `renamed-new.txt` while leaving `staged.txt` staged in `Staged Changes`.

---

## S4: Webview View in `views.scm`

- **Goal:** Verify that a `type: "webview"` view in `views.scm` with `visibility: "collapsed"` is accepted and renders.
- **Manifest Check:** `package.json` contributes:
  ```json
  "views": {
    "scm": [
      {
        "type": "webview",
        "id": "gitflux.panel",
        "name": "Commit With Custom Date",
        "when": "workspaceFolderCount > 0",
        "visibility": "collapsed"
      }
    ]
  }
  ```
- **Validation:** VS Code extension manifest validation succeeds. `npx vsce ls` accepts the manifest. Live testing in Extension Development Host confirms webview renders with Preact UI and responds to `gitflux.panel.focus`.
- **Outcome:** **OBSERVED (runtime in VS Code Extension Development Host on macOS)**. The webview view declared in `views.scm` renders successfully in the Source Control side pane, expands/collapses properly, and responds to `gitflux.panel.focus` command.

---

## S5: `Repository.push` Signature and Error Codes

- **Goal:** Verify `Repository.push(remote, branch, setUpstream)` signature and `gitErrorCode` on failures.
- **Evidence from `git.d.ts` & runtime verification:**
  ```ts
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
  ```
  And `GitErrorCodes` enum:
  - `PushRejected = "PushRejected"`
  - `AuthenticationFailed = "AuthenticationFailed"`
  - `RemoteConnectionError = "RemoteConnectionError"`
- **Outcome:** **OBSERVED (runtime in VS Code Extension Development Host on macOS)**. Verified `repository.push("origin", "main", { setUpstream: true })` (or `(remote, branch, true)`) executed successfully against a local bare remote `origin` during live F5 testing on `/Users/advaet/Projects/gitflux-smoke-repo`, updating upstream tracking without error.

---

## S6: Windows PowerShell Quoting and Exit Code Chaining

- **Goal:** Verify Windows PowerShell 5.1 and 7 behavior for embedded `"` in native args and `$LASTEXITCODE` chaining.
- **Findings from Blueprint §8.2 & AM-14:**
  - PowerShell 5.1 strips `"` in native args unless escaped or handled.
  - Mitigated by rejecting `"` entirely in `pwsh` and `powershell` terminal renders (part of extra rejected chars: `R0` + `"`).
  - Terminal template uses:
    `unit1; if ($LASTEXITCODE -eq 0) { unit2; if ($LASTEXITCODE -eq 0) { unit3 } }`
    wrapped in `try { ... } finally { Remove-Item Env:GIT_AUTHOR_DATE,Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }`.
- **Outcome:** **OBSERVED partially on pwsh 7.7.0-rc.1 (macOS); Windows PowerShell 5.1 & cmd.exe PENDING CI (windows-latest)**. pwsh on macOS successfully executes all 18 hostile vectors with zero canary hits; Windows PowerShell 5.1 and cmd.exe execution pending CI on windows-latest.

---

## S7: Context-Menu Command Argument Shapes (AM-17)

- **Goal:** Record exact runtime argument shapes passed from context menus:
  1. `explorer/context`: `(clickedUri: vscode.Uri, selectedUris?: vscode.Uri[])`
  2. `scm/resourceState/context`: `(state: SourceControlResourceState, ...states: SourceControlResourceState[])`
  3. `scm/resourceFolder/context`: `(folder: SourceControlResourceGroup | SourceControlResourceFolder)`
- **Behavior in `resourceResolver.ts` & Runtime Verification:**
  - Accepts raw `(...args: unknown[])`
  - Normalizes any `Uri` or `{ resourceUri: Uri }` shapes
  - Drops non-`file:` schemes
  - Gracefully handles unknown/empty arguments without throwing
  - Normalizes macOS symlinks (`/private/tmp` vs `/tmp`) so clicking SCM changes matches repository root
  - Pushes updated snapshot post-commit so committed files clear immediately from webview
- **Outcome:** **OBSERVED (runtime in VS Code Extension Development Host on macOS)**. Verified context menu invocation from SCM Changes list passes `SourceControlResourceState` arguments to `gitflux.openForSelection`; preselection correctly preselects the clicked file, handles renamed files via `renameUri`/`originalUri`, and refreshes snapshot post-commit to clear committed files from the UI.
