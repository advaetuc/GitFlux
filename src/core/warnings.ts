import type { ChangedFile, CommitPlan, HeadState } from "./types";

export type PlanWarning =
  | "FUTURE_DATE"
  | "BEFORE_PARENT"
  | "SUBJECT_OVER_72"
  | "BEHIND_UPSTREAM"
  | "DETACHED_HEAD"
  | "PARTIALLY_STAGED";

/**
 * Computes non-blocking warnings for a commit plan.
 * Pure arithmetic/logic: `nowEpochSeconds` is injected so core never reads system clock.
 * Follows rules in AM-04.
 */
export function planWarnings(args: {
  readonly plan: CommitPlan;
  readonly head: HeadState;
  readonly files: readonly ChangedFile[];
  readonly headCommitEpochSeconds: number | undefined;
  readonly nowEpochSeconds: number; // injected; core never reads the clock
}): readonly PlanWarning[] {
  const warnings: PlanWarning[] = [];

  // FUTURE_DATE if timestamp.epochSeconds > now + 300
  if (args.plan.timestamp.epochSeconds > args.nowEpochSeconds + 300) {
    warnings.push("FUTURE_DATE");
  }

  // BEFORE_PARENT if headCommitEpochSeconds !== undefined && epochSeconds < headCommitEpochSeconds
  if (
    args.headCommitEpochSeconds !== undefined &&
    args.plan.timestamp.epochSeconds < args.headCommitEpochSeconds
  ) {
    warnings.push("BEFORE_PARENT");
  }

  // SUBJECT_OVER_72 if paragraphs[0].length > 72
  const subject = args.plan.message.paragraphs[0];
  if (subject && subject.length > 72) {
    warnings.push("SUBJECT_OVER_72");
  }

  // BEHIND_UPSTREAM if head.kind === "branch" && head.behind > 0 && plan.push
  if (args.head.kind === "branch" && args.head.behind > 0 && args.plan.push !== undefined) {
    warnings.push("BEHIND_UPSTREAM");
  }

  // DETACHED_HEAD if head.kind === "detached"
  if (args.head.kind === "detached") {
    warnings.push("DETACHED_HEAD");
  }

  // PARTIALLY_STAGED if any selected file has staged && unstaged
  const selectedSet = new Set<string>(args.plan.paths);
  const isPartiallyStaged = args.files.some(
    (f) => selectedSet.has(f.path) && f.staged && f.unstaged,
  );
  if (isPartiallyStaged) {
    warnings.push("PARTIALLY_STAGED");
  }

  return warnings;
}
