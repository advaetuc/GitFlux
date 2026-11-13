import { PREFIX_CHIPS } from "../draftReducer";
import type { PrefixChip } from "../draftReducer";

export interface MessageFieldsProps {
  readonly subject: string;
  readonly body: string;
  readonly onSetSubject: (subject: string) => void;
  readonly onSetBody: (body: string) => void;
  readonly onApplyPrefixChip: (prefix: PrefixChip) => void;
}

export function MessageFields({
  subject,
  body,
  onSetSubject,
  onSetBody,
  onApplyPrefixChip,
}: MessageFieldsProps) {
  const isOver72 = subject.length > 72;

  return (
    <div class="form-section">
      <div class="section-label">
        <span>Commit Message</span>
        <span class={`char-counter ${isOver72 ? "char-counter-warning" : ""}`}>
          {subject.length} / 72
        </span>
      </div>

      <div class="row-wrap">
        {PREFIX_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            class="chip"
            onClick={() => {
              onApplyPrefixChip(chip);
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Subject (required, <= 500 chars)"
        value={subject}
        onInput={(e) => {
          onSetSubject((e.target as HTMLInputElement).value);
        }}
      />

      <textarea
        placeholder="Optional body paragraphs..."
        value={body}
        onInput={(e) => {
          onSetBody((e.target as HTMLTextAreaElement).value);
        }}
      />
    </div>
  );
}
