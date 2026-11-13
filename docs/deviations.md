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
