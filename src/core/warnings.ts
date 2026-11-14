import type { ChangedFile, CommitPlan, HeadState, LocalDateTime } from "./types";
import { utcDateOf } from "./heatmap";

export type PlanWarning =
  | "FUTURE_DATE"
  | "BEFORE_PARENT"
  | "SUBJECT_OVER_72"
  | "BEHIND_UPSTREAM"
  | "DETACHED_HEAD"
  | "PARTIALLY_STAGED"
  | "UTC_DAY_SHIFT";

/**
 * Returns formatted text warning user that GitHub shows activity in UTC.
 */
export function formatUtcDayShiftWarning(epochSeconds: number): string {
  const utcDate = utcDateOf(epochSeconds);
  return `GitHub will show this on ${utcDate} (UTC).`;
}

/**
 * Classifies Git user.email for suitability on GitHub.
 * - "missing": empty or whitespace
 * - "generic": no dot in domain or ends with .local, .localdomain, or .(none)
 * - "ok": valid domain structure
 */
export function classifyEmail(email: string | undefined): "missing" | "generic" | "ok" {
  if (!email || email.trim() === "") {
    return "missing";
  }
  const trimmed = email.trim();
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx === -1) {
    return "generic";
  }
  const domain = trimmed.slice(atIdx + 1).toLowerCase();
  if (!domain.includes(".")) {
    return "generic";
  }
  if (
    domain.endsWith(".local") ||
    domain.endsWith(".localdomain") ||
    domain.endsWith(".(none)")
  ) {
    return "generic";
  }
  return "ok";
}

/**
 * Computes non-blocking warnings for a commit plan.
 * Pure arithmetic/logic: `nowEpochSeconds` is injected so core never reads system clock.
 * Follows rules in AM-04 and Milestone B.
 */
export function planWarnings(args: {
  readonly plan: CommitPlan;
  readonly head: HeadState;
  readonly files: readonly ChangedFile[];
  readonly headCommitEpochSeconds: number | undefined;
  readonly nowEpochSeconds: number; // injected; core never reads the clock
  readonly localDateStr?: string;
  readonly whenLocal?: LocalDateTime;
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

  // UTC_DAY_SHIFT if UTC date differs from local wall-clock date
  const targetDateStr =
    args.localDateStr ??
    (args.whenLocal
      ? `${String(args.whenLocal.year).padStart(4, "0")}-${String(args.whenLocal.month).padStart(2, "0")}-${String(args.whenLocal.day).padStart(2, "0")}`
      : undefined);

  if (
    targetDateStr !== undefined &&
    utcDateOf(args.plan.timestamp.epochSeconds) !== targetDateStr
  ) {
    warnings.push("UTC_DAY_SHIFT");
  }

  return warnings;
}
