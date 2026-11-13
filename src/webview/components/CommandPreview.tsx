import type { ShellSetting } from "../../core/types";

export interface CommandPreviewProps {
  readonly shell: ShellSetting;
  readonly preview: string;
  readonly onSetShell: (shell: ShellSetting) => void;
}

const SHELL_OPTIONS: { readonly value: ShellSetting; readonly label: string }[] = [
  { value: "auto", label: "Auto (detect terminal)" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "sh", label: "POSIX sh" },
  { value: "fish", label: "Fish" },
  { value: "pwsh", label: "PowerShell Core (pwsh)" },
  { value: "powershell", label: "Windows PowerShell" },
  { value: "cmd", label: "Windows cmd.exe" },
];

export function CommandPreview({ shell, preview, onSetShell }: CommandPreviewProps) {
  return (
    <div class="form-section">
      <div class="section-label">
        <span>Command Preview</span>
        <select
          value={shell}
          onChange={(e) => {
            onSetShell((e.target as HTMLSelectElement).value as ShellSetting);
          }}
        >
          {SHELL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div class="preview-box" tabIndex={0} role="region" aria-label="Command Preview">
        <code>{preview}</code>
      </div>
    </div>
  );
}
