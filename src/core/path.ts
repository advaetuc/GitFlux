import type { GitPath, Result } from "./types";

export type PathError = "EMPTY" | "ABSOLUTE" | "TRAVERSAL" | "ILLEGAL_CHARACTER" | "TOO_LONG";

/**
 * Validates a repo-relative path.
 * Must be POSIX separators, non-empty, <= 4096 chars, no NUL/CR/LF,
 * not absolute, and no ".." traversal segment.
 */
export function validateGitPath(raw: string): Result<GitPath, PathError> {
  if (raw.length === 0) {
    return { ok: false, error: "EMPTY" };
  }

  if (raw.length > 4096) {
    return { ok: false, error: "TOO_LONG" };
  }

  if (raw.includes("\0") || raw.includes("\r") || raw.includes("\n")) {
    return { ok: false, error: "ILLEGAL_CHARACTER" };
  }

  // Absolute paths: starts with / or \ or drive letter like C:
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[a-zA-Z]:/.test(raw)) {
    return { ok: false, error: "ABSOLUTE" };
  }

  // Check segments for traversal
  const segments = raw.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      return { ok: false, error: "TRAVERSAL" };
    }
  }

  return { ok: true, value: raw as GitPath };
}

/**
 * Converts an absolute path to POSIX format with forward slashes.
 * Strips trailing slash except for root ("/") or drive root (e.g. "C:/").
 */
export function toPosixRoot(absolutePath: string): string {
  // Convert backslashes to forward slashes
  let posix = absolutePath.replace(/\\/g, "/");

  // Collapse duplicate slashes except leading in UNC paths if any
  // But preserve drive roots like C:/
  // Check if it's already root
  if (posix === "/") {
    return "/";
  }

  // Windows drive root check: e.g. "C:/" or "c:/"
  if (/^[a-zA-Z]:\/$/.test(posix)) {
    return posix;
  }

  // Windows drive without slash: e.g. "C:" -> "C:/"
  if (/^[a-zA-Z]:$/.test(posix)) {
    return `${posix}/`;
  }

  // Strip trailing slashes
  while (posix.length > 1 && posix.endsWith("/")) {
    if (/^[a-zA-Z]:\/$/.test(posix)) {
      break;
    }
    posix = posix.slice(0, -1);
  }

  return posix;
}
