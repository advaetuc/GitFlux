# Deviations

Deviations from the Blueprint forced by reality are recorded below.

---

DEV-1 | Phase 4 | Blueprint §6.1, Master Prompt §7 Phase 4 Item 5
Expected (per source): "package": "vsce package" in package.json scripts.
Observed (evidence: command + output excerpt):
`vsce package` without a repository URL in package.json prompts or fails packaging with `error: A 'repository' field is missing from the 'package.json' manifest file.`
Resolution chosen (and why it is the safer/more restrictive option):
Added `--allow-missing-repository --no-git-tag-version` to `package.json`'s package script as explicitly permitted by Master Prompt §7 Phase 4 Item 5.
Impact on tests/docs: None; packaging produces valid VSIX archive cleanly without modifying git tags or requiring a mock remote repo.

---

DEV-2 | Phase 2 | Blueprint §7.1, Blueprint §9.1
Expected (per source): `execFile` options typed with `ExecFileOptions`.
Observed (evidence: command + output excerpt):
`tsc` error TS2353: `Object literal may only specify known properties, and 'encoding' does not exist in type 'ExecFileOptions'`.
Resolution chosen (and why it is the safer/more restrictive option):
Imported `ExecFileOptionsWithStringEncoding` from `node:child_process` which explicitly allows `encoding: "utf8"` and produces typed string output.
Impact on tests/docs: Type safety preserved under Node 20 types without casting.

---

DEV-3 | Phase 1 & 2 | Blueprint §0.3, Blueprint §7.2
Expected (per source): Interfaces with optional properties e.g. `oldPath?: string;` and `upstream?: string;`.
Observed (evidence: command + output excerpt):
With `exactOptionalPropertyTypes: true` enforced by Blueprint §0.3, passing `{ oldPath: undefined }` or `{ upstream: undefined }` triggers TS2379 (`Type 'undefined' is not assignable to type 'string'`).
Resolution chosen (and why it is the safer/more restrictive option):
Omit optional properties conditionally using `...(val ? { key: val } : {})` or declare internal mutable builder map properties with `| undefined`.
Impact on tests/docs: Fully compliant with strict `exactOptionalPropertyTypes`.

---

DEV-4 | Phase 4 | Master Prompt §3.4, Verification-Hardening Task 4
Expected (per source): Only files listed in Blueprint §5.1 / Master Prompt §3.4 allowed without recorded reason.
Observed (evidence: command + output excerpt):
Task 4 requires an F5 extension host runtime spike logger writing to OutputChannel `Commit With Custom Date [Diag]` when `GITFLUX_SPIKE_LOG === "1"`. Placing logger functions across `extension.ts`, `repoState.ts`, and `runner.ts` caused circular dependency concerns, while placing them in `ids.ts` would force `ids.ts` to import `vscode` and break pure manifest unit tests.
Resolution chosen (and why it is the safer/more restrictive option):
Created isolated leaf module `src/host/diag.ts` exporting `logDiag` and `getDiagChannel`.
Impact on tests/docs: Clean separation of concerns, zero circular dependencies, leaves `ids.ts` pure.

---

DEV-5 | Phase 0 & 4 | Blueprint §2 Fact S1, Master Prompt §6
Expected (per source): Verify spikes S1 and S2 against Git 2.26.0 specifically.
Observed (evidence: command + output excerpt):
Git 2.26.0 (released March 2020) is not available locally or on standard modern CI runners (local environment runs Git 2.54.0; ubuntu-latest runs Git 2.43+).
Resolution chosen (and why it is the safer/more restrictive option):
Executed spikes S1 and S2 against runtime Git 2.54.0 locally and default Git on CI runners. Verified all required flags (`--literal-pathspecs`, `--pathspec-from-file`, `--pathspec-file-nul`, `--only`, `--cleanup=whitespace`) succeed. Backwards compatibility for Git 2.26.0 is documented as UNVERIFIED locally in `docs/environment.md` and `docs/spikes.md`.
Impact on tests/docs: All spike verifications green on available Git versions.

---

DEV-6 | Phase 0 & 4 | Master Prompt §3.4
Expected (per source): Only tooling files in Master Prompt §3.4 allowlist allowed without recorded reason.
Observed (evidence: command + output excerpt):
Repository contains `.gitattributes` specifying `* text=auto`.
Resolution chosen (and why it is the safer/more restrictive option):
Retained `.gitattributes` to enforce consistent LF line endings across POSIX and Windows runners, preventing CRLF corruption of shell scripts (`docs/spikes/s1.sh`, `docs/spikes/s2.sh`) and cross-platform matrix test assertions on Windows checkouts.
Impact on tests/docs: Shell matrix and fixture tests remain reliable when cloned across Windows, macOS, and Linux runners.
