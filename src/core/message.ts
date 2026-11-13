import type { NormalizedMessage, MessageError, Result } from "./types";

/**
 * Normalizes commit subject and body into separate single-line paragraphs.
 * paragraphs[0] is the subject. Each subsequent paragraph is a non-empty body paragraph.
 * Soft wraps within paragraphs are collapsed to a single space.
 * Enforces subject <= 500 chars and total message length <= 8192 chars.
 */
export function normalizeMessage(
  subject: string,
  body: string,
): Result<NormalizedMessage, MessageError> {
  if (subject.includes("\0") || body.includes("\0")) {
    return { ok: false, error: "NUL_CHARACTER" };
  }

  if (subject.includes("\n") || subject.includes("\r")) {
    return { ok: false, error: "SUBJECT_MULTILINE" };
  }

  const trimmedSubject = subject.trim();
  if (trimmedSubject.length === 0) {
    return { ok: false, error: "EMPTY_SUBJECT" };
  }

  if (trimmedSubject.length > 500) {
    return { ok: false, error: "TOO_LONG" };
  }

  // Split body into paragraphs on blank lines
  const rawParagraphs = body.split(/\r?\n(?:\s*\r?\n)+/);
  const bodyParagraphs: string[] = [];

  for (const rawPara of rawParagraphs) {
    // Collapse internal newlines and surrounding whitespace into a single space
    const collapsed = rawPara
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (collapsed.length > 0) {
      bodyParagraphs.push(collapsed);
    }
  }

  const allParagraphs: [string, ...string[]] = [trimmedSubject, ...bodyParagraphs];
  const totalLength = allParagraphs.join("\n\n").length;

  if (totalLength > 8192) {
    return { ok: false, error: "TOO_LONG" };
  }

  return {
    ok: true,
    value: {
      paragraphs: allParagraphs,
    },
  };
}
