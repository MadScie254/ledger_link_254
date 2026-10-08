import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { buttonClass } from '../ledger/Page';
import { downloadDocumentPdf } from '../../utils/downloadDocument';
import type { PrintKind } from '../../utils/printDocument';

/**
 * Saves one invoice, credit note, estimate, receipt or order as a PDF to
 * send or print. Open to every role: it reads, it posts nothing.
 */
export function PrintButton({ kind, id, number, variant = 'quiet' }: { kind: PrintKind; id: string; number: string; variant?: 'quiet' | 'secondary' }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      await downloadDocumentPdf(kind, id);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That document could not be prepared for printing. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={buttonClass[variant]}
        disabled={busy}
        // Rows that open on a click stay closed.
        onClick={(event) => { event.stopPropagation(); void save(); }}
        aria-label={`Save ${number} as a PDF`}
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Preparing' : variant === 'secondary' ? 'Save as PDF' : 'PDF'}
      </button>
      {problem && <span role="alert" className="text-[12.5px] text-ledger-red">{problem}</span>}
    </>
  );
}
