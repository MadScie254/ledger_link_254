/**
 * The moment a record is posted: one decisive stamp, not a spinner or a
 * checkmark. Mount it only for the ~500ms a caller holds it on screen after
 * a successful post; it plays once and does not loop.
 */
export function PostedStamp({ label = 'Posted' }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-paper-100/85" role="status">
      <div className="ll-stamp flex items-center gap-2 border-2 border-oxblood px-4 py-2 text-oxblood">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="4 12 10 18 20 6" />
        </svg>
        <span className="ll-printed text-[15px] tracking-[0.12em]">{label}</span>
      </div>
    </div>
  );
}
