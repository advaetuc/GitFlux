# Dev Display Name

Stage selected changed files and commit them with a custom author and committer date directly from VS Code.

## Features

- **Granular File Selection:** Select files from the Explorer context menu, SCM view, or Command Palette.
- **Custom Timestamps:** Specify wall-clock date, time (including seconds in 24-hour format), and timezone offset (local or fixed intervals from UTC−12:00 to UTC+14:00).
- **Working Hours Jitter:** Quickly pick a randomized timestamp within configured working hours.
- **Commit Message & Prefix Chips:** Subject and body fields with fixed conventional commit prefix chips (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) and 72-character soft length indicator.
- **Three Execution Modes:**
  - **Run Now:** Executes `git` directly using argument arrays (never touching a shell), verifies author and committer timestamps post-commit, and optionally pushes.
  - **Copy:** Copies a shell-specific, one-line command to the clipboard (supports Bash, Zsh, POSIX sh, Fish, PowerShell Core, Windows PowerShell, and cmd.exe).
  - **Send to Terminal:** Sends the command to a dedicated integrated terminal for the repository.

## Requirements

- **Git:** Git ≥ 2.26.0 is required for **Run Now** (due to `--pathspec-from-file` support). For Git versions older than 2.26.0, **Run Now** is disabled, but **Copy** and **Send to Terminal** remain available.
- **Workspace Trust:** This extension requires a trusted workspace because executing Git commands can invoke repository hooks and configuration.
- **Filesystem:** Requires a real local or remote working tree on disk (virtual workspaces are not supported).
- **Git Extension:** The built-in VS Code Git extension (`vscode.git`) must be enabled.

## Security and Safety Guarantees

- **No History Rewriting:** The extension only creates new commits. It never amends or rewrites past commits.
- **No Force Push:** Pushing after commit is strictly a fast-forward operation (`git push`). The `--force` flag is never emitted.
- **No Command Injection:** In **Run Now**, Git is invoked directly using argument vectors (`execFile`), eliminating shell injection vectors.
- **Shell Escaping and Dialect Verification:** When copying or sending to a terminal, inputs are strictly escaped and quoted for the specific shell dialect. Characters that cannot be safely escaped in a particular shell (e.g. `%` or `^` in `cmd.exe`) are rejected with an explicit warning prompting the user to select another dialect or use **Run Now**.
- **Send to Terminal Dialect Guard:** The **Send to Terminal** action is only permitted when the selected dialect matches the detected default terminal shell profile.

## Configuration

- `dev-extension.shell`: Preferred shell dialect for Copy and Send to Terminal (`auto`, `bash`, `zsh`, `sh`, `fish`, `pwsh`, `powershell`, `cmd`). Defaults to `auto`.
- `dev-extension.workingHours.start`: Start of the working hours window (24-hour `HH:MM`). Defaults to `09:30`.
- `dev-extension.workingHours.end`: End of the working hours window (24-hour `HH:MM`). Defaults to `18:30`.
- `dev-extension.push.defaultEnabled`: Whether **Push after commit** starts checked. Defaults to `false`.
- `dev-extension.terminal.autoRun`: Automatically press Enter after **Send to Terminal**. Application-scoped so repository workspace settings cannot enable it. Defaults to `false`.

## License

UNLICENSED
