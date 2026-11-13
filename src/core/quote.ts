import type { QuoteRule, ShellKind } from "./types";

/**
 * Common rejection set R0 (Blueprint §8.2):
 * U+0000–U+001F (includes TAB, CR, LF, ESC),
 * U+007F–U+009F,
 * U+2028 (Line Separator), U+2029 (Paragraph Separator),
 * Bidi controls: U+202A–U+202E, U+2066–U+2069.
 */
export const R0_REGEX = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/**
 * Formats a character into the printable form required by RenderError.
 * E.g. "U+0025 '%'" or "U+001B (control)".
 */
export function formatUnsafeCharacter(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  const hex = code.toString(16).toUpperCase().padStart(4, "0");
  const isControl =
    (code >= 0 && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);

  if (isControl) {
    return `U+${hex} (control)`;
  }
  return `U+${hex} '${char}'`;
}

/**
 * POSIX single-quote escaping: ' becomes '\''
 */
function quotePosix(val: string): string {
  return `'${val.replace(/'/g, "'\\''")}'`;
}

/**
 * Fish single-quote escaping: \ becomes \\, then ' becomes \'
 */
function quoteFish(val: string): string {
  const escaped = val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * PowerShell single-quote escaping:
 * Doubles every single quote ' and typographical quotes: ‘ ’ ‚ ‛
 */
function quotePowerShell(val: string): string {
  const escaped = val
    .replace(/'/g, "''")
    .replace(/[\u2018]/g, "\u2018\u2018")
    .replace(/[\u2019]/g, "\u2019\u2019")
    .replace(/[\u201A]/g, "\u201A\u201A")
    .replace(/[\u201B]/g, "\u201B\u201B");
  return `'${escaped}'`;
}

/**
 * cmd.exe double-quote wrapping:
 * No escaping attempted; unsafe chars are rejected.
 */
function quoteCmd(val: string): string {
  return `"${val}"`;
}

// Extra forbidden characters:
// pwsh & powershell: R0 + "
const PWSH_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069"]/;

// cmd: R0 + " % ^ !
const CMD_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069"%^!]/;

export const QUOTE_RULES: Readonly<Record<ShellKind, QuoteRule>> = {
  bash: {
    forbidden: R0_REGEX,
    quote: quotePosix,
  },
  zsh: {
    forbidden: R0_REGEX,
    quote: quotePosix,
  },
  sh: {
    forbidden: R0_REGEX,
    quote: quotePosix,
  },
  fish: {
    forbidden: R0_REGEX,
    quote: quoteFish,
  },
  pwsh: {
    forbidden: PWSH_FORBIDDEN,
    quote: quotePowerShell,
  },
  powershell: {
    forbidden: PWSH_FORBIDDEN,
    quote: quotePowerShell,
  },
  cmd: {
    forbidden: CMD_FORBIDDEN,
    quote: quoteCmd,
  },
};
