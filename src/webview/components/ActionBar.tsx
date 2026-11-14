import type { ActionResult, HostEnv, RepoSnapshot, RunStepId } from "../../shared/protocol";
import type { CommitPlan, LocalDateTime, Result, ShellSetting } from "../../core/types";
import type { PlanError } from "../../core/plan";
import type { PlanWarning } from "../../core/warnings";
import { resolveTimestamp } from "../../core/timestamp";
import { resolveEffectiveShell } from "../draftReducer";

export interface ActionBarProps {
  readonly plan: Result<CommitPlan, PlanError>;
  readonly warnings: readonly PlanWarning[];
  readonly selectedCount: number;
  readonly isDetached: boolean;
  readonly detachedAck: boolean;
  readonly env: HostEnv;
  readonly draftShell: ShellSetting;
  readonly inFlight: boolean;
  readonly currentStep: RunStepId | undefined;
  readonly lastResult: ActionResult | undefined;
  readonly snapshot?: RepoSnapshot | undefined;
  readonly when: { readonly local: LocalDateTime; readonly offsetMinutes: number };
  readonly onCommit: () => void;
  readonly onCopy: () => void;
  readonly onSendToTerminal: () => void;
  readonly onAmendHead: () => void;
  readonly onCancel: () => void;
  readonly onSetDetachedAck: (ack: boolean) => void;
}

const RUN_STEPS: RunStepId[] = ["add", "commit", "verify", "push"];

export function ActionBar({
  plan,
  warnings,
  selectedCount,
  isDetached,
  detachedAck,
  env,
  draftShell,
  inFlight,
  currentStep,
  lastResult,
  snapshot,
  when,
  onCommit,
  onCopy,
  onSendToTerminal,
  onAmendHead,
  onCancel,
  onSetDetachedAck,
}: ActionBarProps) {
  const effectiveShell = resolveEffectiveShell(draftShell, env.shellSetting, env.detectedShell);
  const canSendToTerminal =
    env.detectedShell !== "unsupported" && effectiveShell === env.detectedShell;

  const terminalDisabledReason = !canSendToTerminal
    ? "Shell override applies to Copy only"
    : !plan.ok
      ? plan.error.detail
      : "";

  const commitDisabledReason = !env.gitVersionOk
    ? "Git >= 2.26.0 required for Run Now"
    : isDetached && !detachedAck
      ? "Detached HEAD requires acknowledgment"
      : !plan.ok
        ? plan.error.detail
        : "";

  const copyDisabledReason = !plan.ok
    ? plan.error.detail
    : effectiveShell === "none"
      ? "Select a shell"
      : "";

  // Amend HEAD date enablement (Blueprint §10 & §14.2)
  const timeRes = resolveTimestamp(when.local, when.offsetMinutes);
  const isTimestampValid = timeRes.ok;
  const isBranch = snapshot?.head.kind === "branch";
  const hasBlockers = (snapshot?.blockers.length ?? 0) > 0;
  const isPublished = snapshot?.headPublished === true;

  let amendDisabledReason = "";
  if (isPublished) {
    amendDisabledReason = "Commit is already on a remote; changing its date would require a force push (unsupported).";
  } else if (!isBranch) {
    amendDisabledReason = "Amending HEAD date is only supported on a branch.";
  } else if (hasBlockers) {
    amendDisabledReason = `Operation blocked: ${snapshot.blockers.join(", ")} in progress.`;
  } else if (!isTimestampValid) {
    amendDisabledReason = "Invalid date or time";
  }

  const canCommit = !inFlight && commitDisabledReason === "";
  const canCopy = !inFlight && copyDisabledReason === "";
  const canSend = !inFlight && terminalDisabledReason === "";
  const canAmend = !inFlight && amendDisabledReason === "";

  return (
    <div class="form-section">
      {/* Detached HEAD acknowledgment gate */}
      {isDetached && (
        <div class="banner banner-warning">
          <label class="row">
            <input
              type="checkbox"
              checked={detachedAck}
              onChange={(e) => {
                onSetDetachedAck((e.target as HTMLInputElement).checked);
              }}
            />
            <span>I acknowledge I am creating a commit on a detached HEAD.</span>
          </label>
        </div>
      )}

      {/* Non-blocking warnings */}
      {warnings.length > 0 && (
        <div class="banner banner-warning">
          <span class="banner-text">
            Warnings: {warnings.join(", ")}
          </span>
        </div>
      )}

      {/* Last Result display */}
      {lastResult && !lastResult.ok && (
        <div class="banner banner-error">
          <span class="banner-text">{lastResult.message}</span>
        </div>
      )}

      {/* Progress steps */}
      {inFlight && (
        <div class="progress-steps" aria-live="polite">
          <span>Running:</span>
          {RUN_STEPS.map((s) => {
            const isActive = currentStep === s;
            return (
              <span
                key={s}
                class={`progress-step ${isActive ? "progress-step-active" : ""}`}
              >
                {s}
              </span>
            );
          })}
        </div>
      )}

      {/* Action Buttons */}
      <div class="row row-wrap">
        <button
          type="button"
          class="btn btn-primary"
          disabled={!canCommit}
          title={commitDisabledReason}
          onClick={onCommit}
        >
          <span class="codicon codicon-check"></span>
          <span>Commit {selectedCount} {selectedCount === 1 ? "file" : "files"}</span>
        </button>

        <button
          type="button"
          class="btn"
          disabled={!canCopy}
          title={copyDisabledReason}
          onClick={onCopy}
        >
          <span class="codicon codicon-copy"></span>
          <span>Copy</span>
        </button>

        <button
          type="button"
          class="btn"
          disabled={!canSend}
          title={terminalDisabledReason}
          onClick={onSendToTerminal}
        >
          <span class="codicon codicon-terminal"></span>
          <span>Send to Terminal</span>
        </button>

        <button
          type="button"
          class="btn"
          disabled={!canAmend}
          title={amendDisabledReason}
          onClick={onAmendHead}
        >
          <span class="codicon codicon-edit"></span>
          <span>Amend HEAD date</span>
        </button>

        {inFlight && (
          <button type="button" class="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
