# Environment Probe

Date: 2026-11-13T14:41:00+05:30

## System

| Item | Value |
|---|---|
| OS | macOS 27.2.1 (Build 26B131) |
| Architecture | arm64 (Apple Silicon) |
| Node.js | v26.13.0 (≥ 20 ✅) |
| npm | 11.20.0 |
| Git | 2.54.0 (Apple Git-157) |

## Git 2.26.0 Availability

**Not obtainable locally.** No container runtime, no version manager with Git 2.26.
Spikes S1/S2 will run against Git 2.54.0 only.
Git 2.26 verification is **UNVERIFIED** and deferred to CI.
If any S1 flag is unavailable on 2.26, the CI workflow must test this and the minimum
version will be raised accordingly (recorded as a DEV).

## Available Shells

| Shell | Path | Version | Available |
|---|---|---|---|
| bash | /bin/bash | 3.2.57 (macOS stock) | ✅ |
| zsh | /bin/zsh | 5.9 | ✅ |
| sh | /bin/sh | (symlink) | ✅ |
| dash | /bin/dash | — | ✅ |
| fish | — | — | ❌ Not installed |
| pwsh | — | — | ❌ Not installed |
| powershell.exe | — | — | ❌ N/A (macOS) |
| cmd.exe | — | — | ❌ N/A (macOS) |
| Git Bash | — | — | ❌ N/A (macOS) |

## Display / xvfb

- `$DISPLAY`: unset
- `xvfb-run`: not found
- **Extension host tests cannot run locally.** CI (ubuntu with xvfb) required.

## Network

- Sandbox has no network access.
- `npm install` and `vsce` commands require `BypassSandbox: true`.
- VS Code test-electron download also needs network.

## Gates Runnable Locally

| Gate | Locally? | Notes |
|---|---|---|
| Gate 0 (Scaffold/Spikes) | Partial | S1/S2 on Git 2.54 ✅. S3/S4/S5/S7 need extension host — UNVERIFIED. S6 Windows — UNVERIFIED. npm/vsce need network bypass. |
| Gate 1 (Pure Core) | Mostly | Unit tests (Vitest) ✅. Shell-matrix for bash/zsh/sh/dash ✅. fish/pwsh/cmd/powershell UNVERIFIED. |
| Gate 2 (Extension Host) | ❌ | Integration tests need VS Code + xvfb. CI only. |
| Gate 3 (Webview/IPC) | ❌ | Same. |
| Gate 4 (Terminal/Hardening) | ❌ | Same. |

## Git Global Config

- `user.name`: Advaet
- `user.email`: 312525996+advaetuc@users.noreply.github.com
