import type { ChangedFile, FileChangeKind } from "../../shared/protocol";

export interface FileListProps {
  readonly files: readonly ChangedFile[];
  readonly selectedPaths: readonly string[];
  readonly filterText: string;
  readonly onTogglePath: (path: string) => void;
  readonly onSelectAll: (select: boolean) => void;
  readonly onFilterChange: (filter: string) => void;
}

function getBadgeLetter(kind: FileChangeKind): string {
  switch (kind) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "U";
    case "submodule": return "S";
    case "typechange": return "T";
  }
}

export function FileList({
  files,
  selectedPaths,
  filterText,
  onTogglePath,
  onSelectAll,
  onFilterChange,
}: FileListProps) {
  const filtered = filterText
    ? files.filter((f) => f.path.toLowerCase().includes(filterText.toLowerCase()))
    : files;

  const allSelected = files.length > 0 && files.every((f) => selectedPaths.includes(f.path));
  const someSelected = selectedPaths.length > 0 && !allSelected;

  return (
    <div class="form-section">
      <div class="section-label">
        <span>Files ({selectedPaths.length}/{files.length})</span>
        <label class="row">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => {
              onSelectAll((e.target as HTMLInputElement).checked);
            }}
          />
          <span>Select all</span>
        </label>
      </div>

      <input
        type="text"
        placeholder="Filter files..."
        value={filterText}
        onInput={(e) => {
          onFilterChange((e.target as HTMLInputElement).value);
        }}
      />

      <div class="file-list-container">
        {filtered.length === 0 ? (
          <div class="file-row">
            <span class="file-path">{files.length === 0 ? "No changed files" : "No matching files"}</span>
          </div>
        ) : (
          filtered.map((file) => {
            const isSelected = selectedPaths.includes(file.path);
            const badge = getBadgeLetter(file.kind);
            const stageLabel = file.staged && file.unstaged ? "staged+unstaged" : file.staged ? "staged" : "unstaged";

            return (
              <label key={file.path} class="file-row">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    onTogglePath(file.path);
                  }}
                />
                <span class={`file-badge file-badge-${badge}`}>{badge}</span>
                <span class="file-path" title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}>
                  {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
                </span>
                <span class="file-staged-pill">{stageLabel}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
