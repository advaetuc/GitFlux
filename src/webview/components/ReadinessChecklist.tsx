import { classifyEmail } from "../../core/warnings";

export interface ReadinessChecklistProps {
  readonly email: string | undefined;
}

export function ReadinessChecklist({ email }: ReadinessChecklistProps) {
  const status = classifyEmail(email);

  const headerText =
    status === "missing"
      ? "No git user.email configured"
      : `Committing as: ${email ?? ""}`;

  return (
    <details class="readiness-details">
      <summary class="readiness-summary">
        <span class="readiness-title">{headerText}</span>
        <span class="readiness-badge">GitHub Checklist</span>
      </summary>

      {(status === "missing" || status === "generic") && (
        <div class="readiness-advisory">
          This email may not be linked to your GitHub account. Run <code>git config user.name</code> / <code>user.email</code> if needed.
        </div>
      )}

      <ul class="readiness-list">
        <li>The commit email is associated with your GitHub account.</li>
        <li>The repository is standalone, not a fork.</li>
        <li>The commit is on the default branch (or <code>gh-pages</code>).</li>
        <li>Days are bucketed in UTC, and a new commit can take up to 24 hours to appear.</li>
        <li>Private-repository activity shows only if you enable private contributions in your GitHub profile settings.</li>
      </ul>
    </details>
  );
}
