# Manual Smoke Test Verification Checklist (Blueprint §15 Item 5)

This document provides a comprehensive, step-by-step manual testing protocol for verifying the extension inside the VS Code Extension Development Host (launched via F5 using `.vscode/launch.json`).

When launched with F5, `GITFLUX_SPIKE_LOG="1"` is set. Open the **Output** panel in the development host and select **"Commit With Custom Date [Diag]"** from the dropdown to observe runtime diagnostics.

---

## Prerequisites

1. Run `npm run build` to compile both the extension host bundle (`dist/extension.js`) and webview bundle (`dist/webview/`).
2. Press **F5** in VS Code to launch the Extension Development Host window.
3. Open the **Output** panel (`View: Toggle Output`) and switch to the `Commit With Custom Date [Diag]` channel.

---

## 1. Single Repository Workspace

- **Setup:** Open a folder containing a normal Git repository with modified and untracked files.
- **Action:** Open the SCM view in the sidebar. Expand the `Commit With Custom Date` panel.
- **Expected:**
  - Panel renders with changed files listed.
  - Date and time default to current local time (including seconds).
  - Offset displays user's local timezone.
  - Live preview shows valid one-line git command matching selected shell.
  - Diag channel logs `Repository.state entries on snapshot build` with raw `workingTreeChanges` and `indexChanges`.

---

## 2. Explorer File Context Menu

- **Setup:** In Explorer, right click on a modified file `src/a.ts`.
- **Action:** Select **"Commit With Custom Date…"**.
- **Expected:**
  - Panel focuses in the SCM view.
  - The clicked file `src/a.ts` is pre-selected and checked in the file list.
  - Diag channel logs `openForSelection raw arguments` showing the `vscode.Uri` of `src/a.ts`.

---

## 3. Explorer Folder Context Menu (Prefix Expansion)

- **Setup:** Create multiple changes under a folder, e.g. `src/components/A.tsx` and `src/components/B.tsx`.
- **Action:** In Explorer, right-click the `src/components` folder and click **"Commit With Custom Date…"**.
- **Expected:**
  - Panel focuses with both `src/components/A.tsx` and `src/components/B.tsx` pre-selected.
  - Files outside `src/components/` remain unchecked.

---

## 4. SCM File Context Menu

- **Setup:** In the SCM view (Source Control), right-click a changed file in the Changes list.
- **Action:** Select **"Commit With Custom Date…"**.
- **Expected:**
  - Panel focuses with that specific resource pre-selected.
  - Diag channel logs `openForSelection raw arguments` with the `SourceControlResourceState` object.

---

## 5. Command Palette Entry Point

- **Setup:** Open an editor with a file from the repository.
- **Action:** Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`), run `Git: Commit With Custom Date…`.
- **Expected:**
  - Panel focuses with the active editor's file pre-selected.

---

## 6. Multi-Root Workspace

- **Setup:** Open a VS Code workspace containing two distinct Git repositories (`repoA` and `repoB`).
- **Action:** Focus the `Commit With Custom Date` panel.
- **Expected:**
  - Repository picker dropdown appears at the top showing both `repoA` and `repoB`.
  - Switching repositories resets the file selection and updates the file list to the active repository.
  - Selecting files across different repositories in Explorer pre-selects the first repository's files and displays a notification about dropped files.

---

## 7. Submodule Workspace

- **Setup:** Open a repository that contains a submodule (`sub/`).
- **Action 1:** Select a file inside `sub/file.txt` and launch the panel.
  - **Expected:** Resolves to the submodule repository root.
- **Action 2:** In the parent repository, commit a submodule pointer change.
  - **Expected:** Appears in parent repo's file list as `kind: "submodule"`.

---

## 8. Detached HEAD State

- **Setup:** In a test repo, check out a commit SHA (`git checkout <sha>`).
- **Action:** Open the panel.
- **Expected:**
  - Banner warns: `"Commit won't belong to a branch"`.
  - **Push after commit** option is disabled.
  - Commit button is disabled until the user checks the detached-HEAD acknowledgement checkbox.
  - Once checked, commit proceeds and creates commit detached at that SHA.

---

## 9. Unborn Repository (Initial Commit)

- **Setup:** Create a brand new directory with `git init` but no commits yet. Add a file `README.md`.
- **Action:** Open the panel.
- **Expected:**
  - Strategy `index` is used (`git add -- <paths>` followed by `git commit`).
  - No "earlier than parent" warning is shown.
  - If Push is checked, push uses `-u`.
  - Clicking Commit creates the root commit cleanly.
  - If another file is staged in index but not selected in the UI, commit is blocked with an error naming the extra staged file.

---

## 10. Hook Failure Rollback

- **Setup:** Create a repository with `.git/hooks/pre-commit` containing `exit 1` (executable). Stage a tracked file `tracked.txt`. Create a new untracked file `untracked.txt`.
- **Action:** In the panel, select only `untracked.txt` and click Commit.
- **Expected:**
  - Commit fails with `HOOK_REJECTED`.
  - Rollback runs: `untracked.txt` is unstaged via `git rm --cached`.
  - Pre-staged file `tracked.txt` remains staged in index (unaffected).
  - Status reflects `rolledBack: true`.

---

## 11. Push to Local Bare Remote

- **Setup:** Create a bare remote (`git init --bare /tmp/bare-remote.git`) and add it as remote `origin`.
- **Action:** In the panel, make a commit with **Push after commit** enabled.
- **Expected:**
  - Commit is created locally with the specified author and committer dates.
  - Commit is pushed to `origin`.
  - Verification: `git log -1 --format='%ad|%cd' --date=iso-strict` in the bare remote matches the chosen custom date.
  - If push fails (e.g. invalid remote or network rejection), Diag channel logs `repository.push error properties` (`gitErrorCode`, `stderr`, `message`), and the UI reports `"Commit created locally; push failed."`.

---

## 12. Verification of Diagnostic Output

- Check the **Output** channel `Commit With Custom Date [Diag]` to confirm:
  1. `Repository.state entries on snapshot build` logs all file changes, original URIs, and status codes.
  2. `openForSelection raw arguments` logs the exact argument vectors from Explorer and SCM menus.
  3. `repository.push error properties` logs error codes on simulated push failures.

---

## 13. Streak-Gap Picker & Readiness Checklist

- **Setup:** Open a Git repository configured with `user.email` (e.g. `user@example.com`). Ensure multiple commits exist over past weeks.
- **Action:** Open the `Commit With Custom Date` panel.
- **Expected:**
  - **Readiness Checklist (`<details>`):**
    - Summarizes `"Committing as: user@example.com"` with a `"GitHub Checklist"` pill.
    - If email is generic or missing (e.g. `.local` or unset), a warning advisory prompts configuring `git config user.email`.
    - Clicking summary expands the static 5-point contribution eligibility checklist.
  - **Streak Grid (Contribution Activity Heatmap):**
    - 12-week × 7-day grid renders past commit activity.
    - Sunday is row 0, Saturday is row 6; current day sits in the final column at its exact UTC weekday.
    - Future days after today are disabled.
    - Hovering any cell shows tooltip with date and commit count (e.g. `"2026-11-02 (UTC), 2 commits"`).
    - Clicking any past/present cell updates the date fields (`year/month/day`), keeps current time fields untouched, and highlights the selected cell with an outline.
