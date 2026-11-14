import { execFile } from "node:child_process";
import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import type { AmendPlan, CommitPlan } from "../core/types";
import { buildAmendExecPlan, buildExecPlan } from "../core/execPlan";
import type { ActionResult, ErrorCode, RunStepId } from "../shared/protocol";
import { GitErrorCodes } from "./gitStatus";
import type { Repository } from "./vendor/git";
import { logDiag } from "./diag";

export interface RunGitOptions {
  cwd: string;
  stdin?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunGitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

const mutexesByRepo = new Map<string, Promise<void>>();

export function runUnderMutex<T>(repoId: string, action: () => Promise<T>): Promise<T> {
  const current = mutexesByRepo.get(repoId) ?? Promise.resolve();

  const next = current.then(
    async () => {
      return action();
    },
    async () => {
      return action();
    },
  );

  mutexesByRepo.set(
    repoId,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

/**
 * Sanitizes stderr by stripping ANSI escape codes and truncating to 4 KB.
 */
export function sanitizeStderr(raw: string): string {
  // Strip ANSI sequences
  const stripped = raw.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  return stripped.slice(0, 4096);
}

/**
 * Classifies Git stderr output into typed ErrorCode (§9.5).
 */
export function classifyGitError(stderr: string): { code: ErrorCode; fallback?: "sendToTerminal" } {
  if (/(?:nothing (?:added )?to commit|no changes added to commit)/i.test(stderr)) {
    return { code: "NOTHING_TO_COMMIT" };
  }
  if (/(?:Please tell me who you are|unable to auto-detect email address)/i.test(stderr)) {
    return { code: "IDENTITY_MISSING" };
  }
  if (/index\.lock/i.test(stderr)) {
    return { code: "INDEX_LOCKED" };
  }
  if (/gpg failed to sign/i.test(stderr)) {
    return { code: "SIGNING_FAILED", fallback: "sendToTerminal" };
  }
  if (/(?:pre-commit|commit-msg|prepare-commit-msg) hook/i.test(stderr)) {
    return { code: "HOOK_REJECTED" };
  }
  return { code: "GIT_FAILED" };
}

/**
 * Builds clean sanitized Git environment (§8.2).
 */
export function buildGitEnv(extraEnv?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    // Delete GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and GIT_AUTHOR_*, GIT_COMMITTER_*
    if (
      key === "GIT_DIR" ||
      key === "GIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key.startsWith("GIT_AUTHOR_") ||
      key.startsWith("GIT_COMMITTER_")
    ) {
      continue;
    }
    env[key] = val;
  }

  // Enforce consistent locale and non-interactive terminal prompt
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["LC_MESSAGES"] = "C";

  if (extraEnv) {
    Object.assign(env, extraEnv);
  }

  return env;
}

/**
 * Runs git executable directly with argv array (never touches a shell).
 */
export function runGit(
  gitPath: string,
  argv: readonly string[],
  options: RunGitOptions,
): Promise<RunGitResult> {
  // Refuse git.path ending in .cmd or .bat (§8.1)
  const lower = gitPath.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return Promise.resolve({
      ok: false,
      code: 1,
      stdout: "",
      stderr: "Refused to run batch script wrapper (.cmd/.bat). Please configure git.path to point to git.exe directly.",
    });
  }

  return new Promise((resolve) => {
    const execOptions: ExecFileOptionsWithStringEncoding = {
      cwd: options.cwd,
      env: buildGitEnv(options.env),
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      windowsHide: true,
      encoding: "utf8",
    };

    if (options.signal) {
      execOptions.signal = options.signal;
    }

    const child = execFile(gitPath, [...argv], execOptions, (err, stdout, stderr) => {
      const outStr = typeof stdout === "string" ? stdout : "";
      const errStr = typeof stderr === "string" ? stderr : "";
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;

      resolve({
        ok: !err,
        code: exitCode,
        stdout: outStr,
        stderr: errStr,
      });
    });

    if (options.stdin && child.stdin) {
      child.stdin.on("error", (e: NodeJS.ErrnoException) => {
        // Safely ignore EPIPE if git closes stdin early
        if (e.code !== "EPIPE") {
          // ignore
        }
      });
      child.stdin.write(options.stdin, "utf8");
      child.stdin.end();
    }
  });
}

/**
 * Parses verify output: format=%H%x00%ad%x00%cd with date=raw.
 * Returns { sha, author, committer }.
 */
export function parseVerifyOutput(
  raw: string,
): { sha: string; author: { epoch: number; offset: string }; committer: { epoch: number; offset: string } } | undefined {
  const parts = raw.trim().split("\0");
  if (parts.length < 3) return undefined;
  const sha = parts[0] ?? "";
  const authorPart = parts[1] ?? "";
  const committerPart = parts[2] ?? "";

  const aMatch = /^(\d+)\s+([+-]\d{4})$/.exec(authorPart.trim());
  const cMatch = /^(\d+)\s+([+-]\d{4})$/.exec(committerPart.trim());
  if (!aMatch || !cMatch || !aMatch[1] || !aMatch[2] || !cMatch[1] || !cMatch[2]) {
    return undefined;
  }

  return {
    sha,
    author: { epoch: parseInt(aMatch[1], 10), offset: aMatch[2] },
    committer: { epoch: parseInt(cMatch[1], 10), offset: cMatch[2] },
  };
}

/**
 * Maps push errors carrying gitErrorCode from S5 evidence to ActionResult.
 */
export function mapPushError(error: unknown): { code: ErrorCode; fallback?: "sendToTerminal" } {
  const err = error as { gitErrorCode?: string; message?: string };
  const code = err.gitErrorCode;

  if (code === GitErrorCodes.PushRejected) {
    return { code: "PUSH_REJECTED" };
  }
  if (code === GitErrorCodes.AuthenticationFailed) {
    return { code: "AUTH_FAILED", fallback: "sendToTerminal" };
  }
  if (code === GitErrorCodes.RemoteConnectionError) {
    return { code: "NETWORK" };
  }
  return { code: "GIT_FAILED" };
}

export type StepEmitter = (step: RunStepId, status: "start" | "ok" | "fail") => void;

/**
 * Executes a CommitPlan according to the authoritative sequence in §8.1.
 */
export function executePlan(
  gitPath: string,
  repo: Repository,
  repoId: string,
  plan: CommitPlan,
  emit: StepEmitter,
  signal?: AbortSignal,
): Promise<ActionResult> {
  return runUnderMutex(repoId, async () => {
    if (signal?.aborted) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "Operation cancelled.",
        rolledBack: false,
      };
    }

    emit("preflight", "start");
    emit("preflight", "ok");

    const exec = buildExecPlan(plan);
    const cwd = plan.repoRoot;

    // Helper to run rollback
    const doRollback = async (): Promise<boolean> => {
      if (!exec.rollback) return false;
      const res = await runGit(gitPath, exec.rollback.argv, {
        cwd,
        stdin: exec.rollback.stdin,
      });
      return res.ok;
    };

    // Step 1: Add (if present)
    const addStep = exec.steps.find((s) => s.id === "add");
    if (addStep) {
      emit("add", "start");
      const addRes = await runGit(gitPath, addStep.argv, {
        cwd,
        stdin: addStep.stdin,
        signal,
      });
      if (!addRes.ok) {
        emit("add", "fail");
        const classification = classifyGitError(addRes.stderr);
        return {
          ok: false,
          code: classification.code,
          step: "add",
          message: sanitizeStderr(addRes.stderr || "git add failed"),
          rolledBack: false,
          ...(classification.fallback ? { fallback: classification.fallback } : {}),
        };
      }
      emit("add", "ok");
    }

    // Step 2: Commit
    const commitStep = exec.steps.find((s) => s.id === "commit");
    if (!commitStep) {
      return { ok: false, code: "INTERNAL", message: "Missing commit step", rolledBack: false };
    }

    emit("commit", "start");
    let commitRes = await runGit(gitPath, commitStep.argv, {
      cwd,
      stdin: commitStep.stdin,
      env: commitStep.env,
      signal,
    });

    // Retry once after 300 ms on index.lock contention (§9.1)
    if (!commitRes.ok && /index\.lock/i.test(commitRes.stderr)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      commitRes = await runGit(gitPath, commitStep.argv, {
        cwd,
        stdin: commitStep.stdin,
        env: commitStep.env,
        signal,
      });
    }

    if (!commitRes.ok) {
      const rolledBack = await doRollback();
      emit("commit", "fail");
      const classification = classifyGitError(commitRes.stderr);
      return {
        ok: false,
        code: classification.code,
        step: "commit",
        message: sanitizeStderr(commitRes.stderr || "git commit failed"),
        rolledBack,
        ...(classification.fallback ? { fallback: classification.fallback } : {}),
      };
    }
    emit("commit", "ok");

    // Step 3: Verify
    const verifyStep = exec.steps.find((s) => s.id === "verify");
    let verified = false;
    let commitSha = "";

    if (verifyStep) {
      emit("verify", "start");
      const vRes = await runGit(gitPath, verifyStep.argv, { cwd });
      if (vRes.ok) {
        const parsed = parseVerifyOutput(vRes.stdout);
        if (parsed) {
          commitSha = parsed.sha;
          const expectedOffsetStr =
            (plan.timestamp.offsetMinutes >= 0 ? "+" : "-") +
            Math.floor(Math.abs(plan.timestamp.offsetMinutes) / 60)
              .toString()
              .padStart(2, "0") +
            (Math.abs(plan.timestamp.offsetMinutes) % 60).toString().padStart(2, "0");

          const authorMatch =
            parsed.author.epoch === plan.timestamp.epochSeconds &&
            parsed.author.offset === expectedOffsetStr;
          const committerMatch =
            parsed.committer.epoch === plan.timestamp.epochSeconds &&
            parsed.committer.offset === expectedOffsetStr;

          verified = authorMatch && committerMatch;
        }
      }
      emit("verify", verified ? "ok" : "fail");
    }

    // If commitSha is empty, resolve via rev-parse HEAD
    if (!commitSha) {
      const rev = await runGit(gitPath, ["rev-parse", "HEAD"], { cwd });
      commitSha = rev.stdout.trim();
    }

    // Step 4: Push (if enabled)
    let pushed = false;
    if (plan.push) {
      emit("push", "start");
      try {
        await repo.push(plan.push.remote, plan.push.branch, plan.push.setUpstream);
        pushed = true;
        emit("push", "ok");
      } catch (e) {
        if (process.env.GITFLUX_SPIKE_LOG === "1") {
          const errObj = e as { gitErrorCode?: string; stderr?: string; message?: string };
          logDiag("repository.push error properties", {
            gitErrorCode: errObj.gitErrorCode,
            stderr: errObj.stderr,
            message: errObj.message ?? String(e),
          });
        }
        emit("push", "fail");
        const pushError = mapPushError(e);
        return {
          ok: false,
          code: pushError.code,
          step: "push",
          message: "Commit created locally; push failed.",
          rolledBack: false,
          ...(pushError.fallback ? { fallback: pushError.fallback } : {}),
        };
      }
    }

    // Refresh repository status
    try {
      await repo.status();
    } catch {
      // ignore
    }

    return {
      ok: true,
      action: "run",
      commitSha,
      verified,
      pushed,
    };
  });
}

/**
 * Checks whether the current HEAD commit is already published to a remote (Blueprint §10).
 * Returns true if HEAD is an ancestor of @{upstream} (exit 0) or if any remote branch contains HEAD.
 */
export async function isHeadPublished(gitPath: string, repoRoot: string): Promise<boolean> {
  const mb = await runGit(gitPath, ["merge-base", "--is-ancestor", "HEAD", "@{upstream}"], {
    cwd: repoRoot,
  });
  if (mb.ok && mb.code === 0) {
    return true;
  }

  const br = await runGit(gitPath, ["branch", "-r", "--contains", "HEAD"], {
    cwd: repoRoot,
  });
  if (br.ok && br.stdout.trim().length > 0) {
    return true;
  }

  return false;
}

/**
 * Executes an AmendPlan according to Blueprint §10 and §14.2 (Phase 5).
 * Shares the exact per-repo mutex, env sanitization, index.lock retry, stderr classification, and repo.status() refresh.
 */
export function executeAmendPlan(
  gitPath: string,
  repo: Repository,
  repoId: string,
  plan: AmendPlan,
  emit: StepEmitter,
  signal?: AbortSignal,
): Promise<ActionResult> {
  return runUnderMutex(repoId, async () => {
    if (signal?.aborted) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "Operation cancelled.",
        rolledBack: false,
      };
    }

    emit("preflight", "start");
    emit("preflight", "ok");

    const exec = buildAmendExecPlan(plan);
    const cwd = plan.repoRoot;

    // Step 1: Commit (amend)
    const commitStep = exec.steps.find((s) => s.id === "commit");
    if (!commitStep) {
      return { ok: false, code: "INTERNAL", message: "Missing commit step", rolledBack: false };
    }

    emit("commit", "start");
    let commitRes = await runGit(gitPath, commitStep.argv, {
      cwd,
      stdin: commitStep.stdin,
      env: commitStep.env,
      signal,
    });

    // Retry once after 300 ms on index.lock contention (§9.1)
    if (!commitRes.ok && /index\.lock/i.test(commitRes.stderr)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      commitRes = await runGit(gitPath, commitStep.argv, {
        cwd,
        stdin: commitStep.stdin,
        env: commitStep.env,
        signal,
      });
    }

    if (!commitRes.ok) {
      emit("commit", "fail");
      const classification = classifyGitError(commitRes.stderr);
      return {
        ok: false,
        code: classification.code,
        step: "commit",
        message: sanitizeStderr(commitRes.stderr || "git commit --amend failed"),
        rolledBack: false,
        ...(classification.fallback ? { fallback: classification.fallback } : {}),
      };
    }
    emit("commit", "ok");

    // Step 2: Verify
    const verifyStep = exec.steps.find((s) => s.id === "verify");
    let verified = false;
    let commitSha = "";

    if (verifyStep) {
      emit("verify", "start");
      const vRes = await runGit(gitPath, verifyStep.argv, { cwd });
      if (vRes.ok) {
        const parsed = parseVerifyOutput(vRes.stdout);
        if (parsed) {
          commitSha = parsed.sha;
          const expectedOffsetStr =
            (plan.timestamp.offsetMinutes >= 0 ? "+" : "-") +
            Math.floor(Math.abs(plan.timestamp.offsetMinutes) / 60)
              .toString()
              .padStart(2, "0") +
            (Math.abs(plan.timestamp.offsetMinutes) % 60).toString().padStart(2, "0");

          const authorMatch =
            parsed.author.epoch === plan.timestamp.epochSeconds &&
            parsed.author.offset === expectedOffsetStr;
          const committerMatch =
            parsed.committer.epoch === plan.timestamp.epochSeconds &&
            parsed.committer.offset === expectedOffsetStr;

          verified = authorMatch && committerMatch;
        }
      }
      emit("verify", verified ? "ok" : "fail");
    }

    if (!commitSha) {
      const rev = await runGit(gitPath, ["rev-parse", "HEAD"], { cwd });
      commitSha = rev.stdout.trim();
    }

    // Refresh repository status
    try {
      await repo.status();
    } catch {
      // ignore
    }

    return {
      ok: true,
      action: "amendHead",
      commitSha,
      verified,
    };
  });
}
