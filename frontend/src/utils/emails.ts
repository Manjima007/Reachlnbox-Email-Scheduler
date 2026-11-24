const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Extracts, de-duplicates (case-insensitive) and lower-cases every
 * email address found in a string of CSV / TXT lead content.
 */
export function extractEmails(input: string): string[] {
  return Array.from(
    new Set((input.match(EMAIL_RE) ?? []).map((value) => value.toLowerCase())),
  );
}
