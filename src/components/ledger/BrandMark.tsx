/**
 * The one custom mark the book carries as its own, rather than a borrowed
 * icon: an open ledger, drawn as two facing pages and the spine between
 * them. Colour comes from `currentColor`, so it always matches the text it
 * sits beside.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5.5C9.7 4.1 6.8 3.6 4 4.3V18c2.8-0.7 5.7-0.2 8 1.2" />
      <path d="M12 5.5c2.3-1.4 5.2-1.9 8-1.2V18c-2.8-0.7-5.7-0.2-8 1.2" />
      <line x1="12" y1="5.5" x2="12" y2="19.2" />
    </svg>
  );
}
