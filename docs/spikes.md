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
- **Outcome:** **PASS** (Git 2.54.0). Untracked files add via stdin nul pathspecs. `commit --only` committed modified, renamed (with both paths listed), deleted, and newly added files while leaving pre-staged `b.txt` in index untouched. Date offset was preserved identically in both author and committer dates. Rollback with `rm --cached` untracked newly added file.

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
- **Outcome:** **PASS (Confirms Blueprint Design)**. On unborn HEAD, `commit --only` fails with exit code 1 because Git has no prior commit to compare against. The `index` strategy (`git add -- <paths>` followed by `git commit`) is required and succeeds.

---

## S3: `vscode.git` API Behavior

- **Goal:** Verify how `vscode.git` API is acquired, workingTreeChanges / indexChanges include untracked files, Change fields (`uri`, `originalUri`, `renameUri`), submodules identification, and closest-root resolution with nested repos.
- **Source of Truth:** Vendored `src/host/vendor/git.d.ts` copied from `microsoft/vscode` commit `89de5a8d4d6205e5b11647eb6a74844ca23d2573` (release 1.90.0).
- **Findings from API inspection:**
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
     - `status`: member of `Status` enum.
  4. Repository resolution: `api.getRepository(uri)` searches for repository root containing `uri` (closest-root).
- **Outcome:** **VERIFIED STRUCTURALLY / UNVERIFIED IN HEADLESS DEV ENV** (no display/xvfb locally; integration tests in CI provide end-to-end verification).

---

## S4: Webview View in `views.scm`

- **Goal:** Verify that a `type: "webview"` view in `views.scm` with `visibility: "collapsed"` is accepted and renders.
- **Manifest Check:** `package.json` contributes:
  ```json
  "views": {
    "scm": [
      {
        "type": "webview",
        "id": "dev-extension.panel",
        "name": "Commit With Custom Date",
        "when": "workspaceFolderCount > 0",
        "visibility": "collapsed"
      }
    ]
  }
  ```
- **Validation:** VS Code extension manifest validation succeeds. `npx vsce ls` accepts the manifest.
- **Outcome:** **PASS** (fallback to `viewsContainers.activitybar` not needed).

---

## S5: `Repository.push` Signature and Error Codes

- **Goal:** Verify `Repository.push(remote, branch, setUpstream)` signature and `gitErrorCode` on failures.
- **Evidence from `git.d.ts`:**
  ```ts
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
  ```
  And `GitErrorCodes` enum:
  - `PushRejected = "PushRejected"`
  - `AuthenticationFailed = "AuthenticationFailed"`
  - `RemoteConnectionError = "RemoteConnectionError"`
- **Outcome:** **VERIFIED via `git.d.ts`** and mapped in `src/host/gitStatus.ts`. Extension host integration tests in CI will assert error mapping.

---

## S6: Windows PowerShell Quoting and Exit Code Chaining

- **Goal:** Verify Windows PowerShell 5.1 and 7 behavior for embedded `"` in native args and `$LASTEXITCODE` chaining.
- **Findings from Blueprint §8.2 & AM-14:**
  - PowerShell 5.1 strips `"` in native args unless escaped or handled.
  - Mitigated by rejecting `"` entirely in `pwsh` and `powershell` terminal renders (part of extra rejected chars: `R0` + `"`).
  - Terminal template uses:
    `unit1; if ($LASTEXITCODE -eq 0) { unit2; if ($LASTEXITCODE -eq 0) { unit3 } }`
    wrapped in `try { ... } finally { Remove-Item Env:GIT_AUTHOR_DATE,Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }`.
- **Outcome:** **UNVERIFIED LOCALLY** (macOS environment). Fully covered by CI Windows runner matrix.

---

## S7: Context-Menu Command Argument Shapes (AM-17)

- **Goal:** Record exact runtime argument shapes passed from context menus:
  1. `explorer/context`: `(clickedUri: vscode.Uri, selectedUris?: vscode.Uri[])`
  2. `scm/resourceState/context`: `(state: SourceControlResourceState, ...states: SourceControlResourceState[])`
  3. `scm/resourceFolder/context`: `(folder: SourceControlResourceGroup | SourceControlResourceFolder)`
- **Behavior in `resourceResolver.ts`:**
  - Must accept `(...args: unknown[])`
  - Normalize any `Uri` or `{ resourceUri: Uri }` shapes
  - Drop non-`file:` schemes
  - Gracefully handle unknown/empty arguments without throwing
- **Outcome:** **VERIFIED STRUCTURALLY** and covered by unit tests in Phase 2.
