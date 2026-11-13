import type { CommitPlan, ExecPlan, ExecStep } from "./types";

/**
 * Builds an ExecPlan for direct execution via git CLI (Run Now mode).
 * Never joins arguments into a shell string; uses argv arrays and stdin.
 * Implements Blueprint §9.3 and AM-13 (rollback operates on untrackedPaths only).
 */
export function buildExecPlan(plan: CommitPlan): ExecPlan {
  const steps: ExecStep[] = [];

  // Step 1: Add
  if (plan.strategy === "index") {
    // Index strategy (unborn HEAD): adds all paths
    steps.push({
      id: "add",
      argv: ["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"],
      stdin: plan.paths.join("\0") + "\0",
    });
  } else if (plan.untrackedPaths.length > 0) {
    // Only strategy: adds only untracked paths
    steps.push({
      id: "add",
      argv: ["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"],
      stdin: plan.untrackedPaths.join("\0") + "\0",
    });
  }

  // Step 2: Commit
  const msgArgs: string[] = [];
  for (const p of plan.message.paragraphs) {
    msgArgs.push("-m", p);
  }

  const commitEnv = {
    GIT_AUTHOR_DATE: plan.timestamp.iso,
    GIT_COMMITTER_DATE: plan.timestamp.iso,
  };

  if (plan.strategy === "only") {
    steps.push({
      id: "commit",
      argv: [
        "--literal-pathspecs",
        "commit",
        "--only",
        "--cleanup=whitespace",
        ...msgArgs,
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      stdin: plan.paths.join("\0") + "\0",
      env: commitEnv,
    });
  } else {
    // Strategy "index": drops --only and --pathspec-from-file
    steps.push({
      id: "commit",
      argv: ["commit", "--cleanup=whitespace", ...msgArgs],
      env: commitEnv,
    });
  }

  // Step 3: Verify
  steps.push({
    id: "verify",
    argv: ["log", "-1", "--format=%H%x00%ad%x00%cd", "--date=raw"],
  });

  // Rollback step (AM-13): operates on plan.untrackedPaths only, never on plan.paths
  let rollback: ExecStep | undefined;
  if (plan.untrackedPaths.length > 0) {
    rollback = {
      id: "rollback",
      argv: [
        "--literal-pathspecs",
        "rm",
        "--cached",
        "-q",
        "--ignore-unmatch",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      stdin: plan.untrackedPaths.join("\0") + "\0",
    };
  }

  return {
    steps,
    ...(rollback ? { rollback } : {}),
    expected: {
      epochSeconds: plan.timestamp.epochSeconds,
      offsetMinutes: plan.timestamp.offsetMinutes,
    },
  };
}
