export interface PushFieldsProps {
  readonly enabled: boolean;
  readonly remote: string;
  readonly remotes: readonly string[];
  readonly disabled?: boolean;
  readonly onSetPushEnabled: (enabled: boolean) => void;
  readonly onSetPushRemote: (remote: string) => void;
}

export function PushFields({
  enabled,
  remote,
  remotes,
  disabled,
  onSetPushEnabled,
  onSetPushRemote,
}: PushFieldsProps) {
  const hasRemotes = remotes.length > 0;
  const isControlDisabled = disabled || !hasRemotes;

  return (
    <div class="form-section">
      <div class="row">
        <label class="row" title={!hasRemotes ? "No remotes configured in repository" : ""}>
          <input
            type="checkbox"
            checked={enabled && hasRemotes}
            disabled={isControlDisabled}
            onChange={(e) => {
              onSetPushEnabled((e.target as HTMLInputElement).checked);
            }}
          />
          <span>Push after commit</span>
        </label>

        {enabled && hasRemotes && (
          <select
            value={remote}
            disabled={isControlDisabled}
            onChange={(e) => {
              onSetPushRemote((e.target as HTMLSelectElement).value);
            }}
          >
            {remotes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
