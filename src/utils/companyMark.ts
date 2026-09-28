/**
 * A company's mark on the page without a logo upload: its initials, always
 * the same two letters for the same name. No file, no storage bucket, no
 * per-company asset to manage — the initials are computed from the name
 * every time they are shown.
 */
export function companyInitials(name: string | undefined | null): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
