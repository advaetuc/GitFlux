import type { CommitPlan, RenderError, RenderField, RenderOptions, ShellKind, ShellRender, Result } from "./types";
import { formatUnsafeCharacter, QUOTE_RULES } from "./quote";
import { toPosixRoot } from "./path";

function findForbidden(val: string, forbidden: RegExp): string | undefined {
  const match = forbidden.exec(val);
  return match ? match[0] : undefined;
}

/**
 * Validates untrusted values against the target shell's forbidden characters.
 * Returns a RenderError if any forbidden character is found.
 */
function validateUntrusted(
  plan: CommitPlan,
  shell: ShellKind,
  options: RenderOptions,
): Result<void, RenderError> {
  const rule = QUOTE_RULES[shell];
  const check = (val: string, field: RenderField): Result<void, RenderError> => {
    const invalidChar = findForbidden(val, rule.forbidden);
    if (invalidChar !== undefined) {
      return {
        ok: false,
        error: {
          code: "UNSAFE_CHARACTER",
          shell,
          field,
          character: formatUnsafeCharacter(invalidChar),
        },
      };
    }
    return { ok: true, value: undefined };
  };

  // Check repoRoot if included in Copy
  if (options.includeRepoDir) {
    const r = check(toPosixRoot(plan.repoRoot), "repoRoot");
    if (!r.ok) return r;
  }

  // Check paths
  for (const p of plan.paths) {
    const r = check(p, "path");
    if (!r.ok) return r;
  }

  // Check commit message paragraphs
  for (const para of plan.message.paragraphs) {
    const r = check(para, "message");
    if (!r.ok) return r;
  }

  // Check push specs
  if (plan.push) {
    const rRemote = check(plan.push.remote, "remote");
    if (!rRemote.ok) return rRemote;
    const rBranch = check(plan.push.branch, "branch");
    if (!rBranch.ok) return rBranch;
  }

  return { ok: true, value: undefined };
}

/**
 * Deterministically renders the shell command for Copy and Send to Terminal.
 * Result is strictly a single line and respects per-shell length limits.
 */
export function renderShell(
  plan: CommitPlan,
  shell: ShellKind,
  options: RenderOptions,
): Result<ShellRender, RenderError> {
  // Validate all untrusted inputs
  const validation = validateUntrusted(plan, shell, options);
  if (!validation.ok) {
    return validation;
  }

  const rule = QUOTE_RULES[shell];
  const q = rule.quote;
  const d = plan.timestamp.iso;

  const rootPrefix = options.includeRepoDir ? ` -C ${q(toPosixRoot(plan.repoRoot))}` : "";

  // 1. Add unit
  let addUnit: string | undefined;
  if (plan.strategy === "index") {
    const quotedPaths = plan.paths.map((p) => q(p)).join(" ");
    addUnit = `git${rootPrefix} --literal-pathspecs add -- ${quotedPaths}`;
  } else if (plan.untrackedPaths.length > 0) {
    const quotedUntracked = plan.untrackedPaths.map((p) => q(p)).join(" ");
    addUnit = `git${rootPrefix} --literal-pathspecs add -- ${quotedUntracked}`;
  }

  // 2. Commit unit
  const msgArgs = plan.message.paragraphs.map((p) => `-m ${q(p)}`).join(" ");
  let commitCore: string;
  if (plan.strategy === "only") {
    const quotedPaths = plan.paths.map((p) => q(p)).join(" ");
    commitCore = `git${rootPrefix} --literal-pathspecs commit --only --cleanup=whitespace ${msgArgs} -- ${quotedPaths}`;
  } else {
    commitCore = `git${rootPrefix} --literal-pathspecs commit --cleanup=whitespace ${msgArgs}`;
  }

  let commitUnit: string;
  switch (shell) {
    case "bash":
    case "zsh":
    case "sh":
      commitUnit = `GIT_AUTHOR_DATE='${d}' GIT_COMMITTER_DATE='${d}' ${commitCore}`;
      break;
    case "fish":
      commitUnit = `env GIT_AUTHOR_DATE='${d}' GIT_COMMITTER_DATE='${d}' ${commitCore}`;
      break;
    case "pwsh":
    case "powershell":
      commitUnit = `try { $env:GIT_AUTHOR_DATE='${d}'; $env:GIT_COMMITTER_DATE='${d}'; ${commitCore} } finally { Remove-Item Env:GIT_AUTHOR_DATE,Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }`;
      break;
    case "cmd":
      commitUnit = `set "GIT_AUTHOR_DATE=${d}" && set "GIT_COMMITTER_DATE=${d}" && ${commitCore}`;
      break;
  }

  // 3. Push unit
  let pushUnit: string | undefined;
  if (plan.push) {
    const uFlag = plan.push.setUpstream ? " -u" : "";
    const pushRoot = options.includeRepoDir ? ` -C ${q(toPosixRoot(plan.repoRoot))}` : "";
    pushUnit = `git${pushRoot} push${uFlag} ${q(plan.push.remote)} ${q(plan.push.branch)}`;
  }

  // Assembly and Chaining
  let singleLine: string;
  if (shell === "cmd") {
    // AM-14: (ADD && set ... && COMMIT && PUSH) & set "GIT_AUTHOR_DATE=" & set "GIT_COMMITTER_DATE="
    const parts: string[] = [];
    if (addUnit) parts.push(addUnit);
    parts.push(commitUnit);
    if (pushUnit) parts.push(pushUnit);
    const inner = parts.join(" && ");
    singleLine = `(${inner}) & set "GIT_AUTHOR_DATE=" & set "GIT_COMMITTER_DATE="`;
  } else if (shell === "pwsh" || shell === "powershell") {
    // Nested: unit1; if ($LASTEXITCODE -eq 0) { unit2; if ($LASTEXITCODE -eq 0) { unit3 } }
    const units: string[] = [];
    if (addUnit) units.push(addUnit);
    units.push(commitUnit);
    if (pushUnit) units.push(pushUnit);

    if (units.length === 1 && units[0] !== undefined) {
      singleLine = units[0];
    } else if (units.length === 2 && units[0] !== undefined && units[1] !== undefined) {
      singleLine = `${units[0]}; if ($LASTEXITCODE -eq 0) { ${units[1]} }`;
    } else if (
      units.length >= 3 &&
      units[0] !== undefined &&
      units[1] !== undefined &&
      units[2] !== undefined
    ) {
      singleLine = `${units[0]}; if ($LASTEXITCODE -eq 0) { ${units[1]}; if ($LASTEXITCODE -eq 0) { ${units[2]} } }`;
    } else {
      singleLine = units.join("; ");
    }
  } else {
    // bash, zsh, sh, fish: join with " && "
    const parts: string[] = [];
    if (addUnit) parts.push(addUnit);
    parts.push(commitUnit);
    if (pushUnit) parts.push(pushUnit);
    singleLine = parts.join(" && ");
  }

  // Length limits: cmd 8000, others 32000
  const limit = shell === "cmd" ? 8000 : 32000;
  if (singleLine.length > limit) {
    return {
      ok: false,
      error: {
        code: "COMMAND_TOO_LONG",
        length: singleLine.length,
        limit,
      },
    };
  }

  return {
    ok: true,
    value: {
      shell,
      singleLine,
    },
  };
}
