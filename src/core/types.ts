// src/core/types.ts — Type-only module (AM-01)
// Functions declared here in the Blueprint are implemented in their own modules.

/** Success/failure without exceptions. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Repo-relative, POSIX separators. No NUL/CR/LF, not absolute, no ".." segment, non-empty, <= 4096 chars. */
export type GitPath = Brand<string, "GitPath">;
/** /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, <= 255 chars. Must also exist in the repo's remote list. */
export type RemoteName = Brand<string, "RemoteName">;
/** Short branch name reported by vscode.git. Valid ref names may contain shell metacharacters: always quoted. */
export type BranchName = Brand<string, "BranchName">;

export type ShellKind = "bash" | "zsh" | "sh" | "fish" | "pwsh" | "powershell" | "cmd";
export type ShellSetting = "auto" | ShellKind;
export type DetectedShell = ShellKind | "unsupported";

// ---- Time -----------------------------------------------------------------

/** Wall-clock components as the user typed them. No timezone semantics. */
export interface LocalDateTime {
  readonly year: number;   // 1970..2099
  readonly month: number;  // 1..12
  readonly day: number;    // 1..31, validated against month/leap year
  readonly hour: number;   // 0..23
  readonly minute: number; // 0..59
  readonly second: number; // 0..59
}

export interface GitTimestamp {
  /** "YYYY-MM-DDTHH:MM:SS±HHMM" — the only format ever written into env vars or commands. */
  readonly iso: string;
  readonly epochSeconds: number;
  /** Minutes east of UTC. Range -720..+840. */
  readonly offsetMinutes: number;
}

export type TimestampError = "INVALID_DATE" | "INVALID_TIME" | "INVALID_OFFSET" | "OUT_OF_RANGE";

export interface TimeWindow {
  readonly startMinutes: number; // minutes since 00:00
  readonly endMinutes: number;   // > startMinutes
}

// ---- Message --------------------------------------------------------------

/**
 * Every paragraph is single-line, non-empty, trimmed, and free of NUL.
 * paragraphs[0] is the subject. Each paragraph becomes one `-m`.
 * Soft wraps inside a body paragraph are collapsed to one space (same rule in every mode).
 */
export interface NormalizedMessage {
  readonly paragraphs: readonly [string, ...string[]];
}
export type MessageError = "EMPTY_SUBJECT" | "SUBJECT_MULTILINE" | "TOO_LONG" | "NUL_CHARACTER";

// ---- Plan -----------------------------------------------------------------

export interface PushSpec {
  readonly remote: RemoteName;
  readonly branch: BranchName;
  readonly setUpstream: boolean;
}

/**
 * "only":  git commit --only -- <paths>   (tracked HEAD present; other staged changes untouched)
 * "index": git add -- <paths> then git commit   (unborn HEAD; requires staged ⊆ selected)
 */
export type CommitStrategy = "only" | "index";

export interface CommitPlan {
  /** Absolute path. Used for `git -C` (Copy mode) and `cwd` (exec mode). */
  readonly repoRoot: string;
  /** Everything in the commit. Renames contribute both old and new path. */
  readonly paths: readonly GitPath[];
  /** Subset of `paths` unknown to git (needs `git add` first under strategy "only"). */
  readonly untrackedPaths: readonly GitPath[];
  readonly strategy: CommitStrategy;
  readonly message: NormalizedMessage;
  readonly timestamp: GitTimestamp;
  readonly push?: PushSpec;
}

// ---- Exec plan (Run Now: no shell involved) ---------------------------------

export type ExecStepId = "add" | "commit" | "verify" | "rollback";

export interface ExecStep {
  readonly id: ExecStepId;
  /** Arguments after the executable; passed as an argv array, never joined into a string. */
  readonly argv: readonly string[];
  /** NUL-separated pathspec list for --pathspec-from-file=- (UTF-8). */
  readonly stdin?: string;
  /** Merged over the sanitized base env. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ExecPlan {
  readonly steps: readonly ExecStep[]; // add?, commit, verify
  readonly rollback?: ExecStep;        // present iff plan added files itself
  readonly expected: { readonly epochSeconds: number; readonly offsetMinutes: number };
}

// ---- Shell render (Copy / Send to Terminal) ---------------------------------

export type RenderField = "message" | "path" | "repoRoot" | "branch" | "remote";

export type RenderError =
  | {
      readonly code: "UNSAFE_CHARACTER";
      readonly shell: ShellKind;
      readonly field: RenderField;
      /** Printable form, e.g. "U+0025 '%'" or "U+001B (control)". */
      readonly character: string;
    }
  | { readonly code: "COMMAND_TOO_LONG"; readonly length: number; readonly limit: number };

export interface RenderOptions {
  /** true for Copy (embed `git -C <root>`); false for Send (terminal cwd is the repo root). */
  readonly includeRepoDir: boolean;
}

export interface ShellRender {
  readonly shell: ShellKind;
  /** Exactly what is copied or sent. One line. Contains no control characters. */
  readonly singleLine: string;
}

// ---- Quoting ----------------------------------------------------------------

export interface QuoteRule {
  /** Characters rejected outright for this shell (checked on every user-derived value). */
  readonly forbidden: RegExp;
  readonly quote: (value: string) => string;
}

// ---- AM-02: Shared snapshot types defined in core ---------------------------

export type FileChangeKind =
  | "modified" | "added" | "deleted" | "renamed" | "untracked" | "typechange" | "submodule";

export interface ChangedFile {
  /** POSIX, repo-relative. */
  readonly path: string;
  /** Present for renames. Host adds it to the pathspec automatically. */
  readonly oldPath?: string;
  readonly kind: FileChangeKind;
  readonly staged: boolean;
  readonly unstaged: boolean;
}

export type HeadState =
  | { readonly kind: "branch"; readonly name: string; readonly upstream?: string; readonly ahead: number; readonly behind: number }
  | { readonly kind: "detached"; readonly shortSha: string }
  | { readonly kind: "unborn"; readonly branch: string };

export type Blocker = "MERGE" | "REBASE" | "CHERRY_PICK" | "REVERT" | "UNMERGED_FILES";
