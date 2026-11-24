const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmails(input: string): string[] {
  return Array.from(
    new Set((input.match(EMAIL_RE) ?? []).map((value) => value.toLowerCase())),
  );
}
