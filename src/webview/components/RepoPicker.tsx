import type { RepoSummary } from "../../shared/protocol";

export interface RepoPickerProps {
  readonly repos: readonly RepoSummary[];
  readonly activeRepoId: string;
  readonly onSelectRepo: (repoId: string) => void;
}

export function RepoPicker({ repos, activeRepoId, onSelectRepo }: RepoPickerProps) {
  if (repos.length <= 1) {
    return null;
  }

  return (
    <div class="form-section">
      <label class="section-label" for="repo-select">
        Repository
      </label>
      <select
        id="repo-select"
        value={activeRepoId}
        onChange={(e) => {
          onSelectRepo((e.target as HTMLSelectElement).value);
        }}
      >
        {repos.map((r) => (
          <option key={r.repoId} value={r.repoId}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
