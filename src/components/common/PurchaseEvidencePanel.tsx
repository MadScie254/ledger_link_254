import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { buttonClass } from '../ledger/Page';
import { Field } from '../ledger/Dialog';

interface Evidence {
  etimsInvoiceNumber?: string | null;
  etimsInvoiceDate?: string | null;
  etimsExemptionReason?: string | null;
}

/** Evidence is supplied by the person entering the purchase, not checked with KRA. */
export function PurchaseEvidencePanel({ kind, id, evidence, canEdit, onSaved }: {
  kind: 'BILL' | 'EXPENSE'; id: string; evidence: Evidence; canEdit: boolean;
  onSaved?: (next: Evidence) => void;
}) {
  const queryClient = useQueryClient();
  const [number, setNumber] = useState(evidence.etimsInvoiceNumber || '');
  const [date, setDate] = useState(evidence.etimsInvoiceDate || '');
  const [reason, setReason] = useState(evidence.etimsExemptionReason || '');
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/${kind === 'BILL' ? 'bills' : 'expenses'}/${id}/etims-evidence`, {
      method: 'PATCH',
      body: { etimsInvoiceNumber: number.trim() || undefined, etimsInvoiceDate: date || undefined,
        etimsExemptionReason: reason.trim() || undefined },
      fallback: 'The purchase evidence could not be saved.',
    }),
    onSuccess: () => {
      setEditing(false);
      setProblem('');
      setNotice('Purchase evidence saved.');
      onSaved?.({ etimsInvoiceNumber: number.trim() || null,
        etimsInvoiceDate: date || null, etimsExemptionReason: reason.trim() || null });
      queryClient.invalidateQueries({ queryKey: ['drilldown'] });
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports_input_vat_at_risk'] });
    },
    onError: (error: Error) => setProblem(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem('');
    setNotice('');
    if (Boolean(number.trim()) !== Boolean(date) || (number.trim() && reason.trim())) {
      setProblem('Enter both the CU invoice number and date, or an exemption reason.');
      return;
    }
    save.mutate();
  }

  return editing ? (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Supplier CU invoice number"><input maxLength={100} value={number} onChange={(event) => setNumber(event.target.value)} /></Field>
      <Field label="CU invoice date"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      <Field label="eTIMS exemption reason" hint="For example, supplier not VAT-registered or exempt supply."><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      {problem && <p role="alert" className="text-sm text-negative">{problem}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={buttonClass.primary}>{save.isPending ? 'Saving' : 'Save evidence'}</button>
        <button type="button" onClick={() => setEditing(false)} className={buttonClass.secondary}>Cancel</button>
      </div>
    </form>
  ) : (
    <div className="space-y-2 text-[13.5px]">
      <p>CU invoice number: {number || 'Not recorded'}</p>
      {number && <p>CU invoice date: {date || 'Not recorded'}</p>}
      <p>Exemption reason: {reason || 'Not recorded'}</p>
      {notice && <p role="status" className="text-positive">{notice}</p>}
      {canEdit && <button type="button" onClick={() => setEditing(true)} className={buttonClass.secondary}>Edit evidence</button>}
    </div>
  );
}
