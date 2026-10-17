import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { useAppStore } from '../../store';
import { ADJUSTMENT_TYPES, ADJUSTMENT_LABELS, type AdjustmentType, type EmployeeAdjustment } from '../../utils/employeeAdjustments';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Field } from '../ledger/Dialog';
import { Amount } from '../ledger/Amount';
import { buttonClass } from '../ledger/Page';
import { AttachmentsPanel } from '../common/AttachmentsPanel';

export function EmployeeAdjustmentsPanel({ employeeId }: { employeeId: string }) {
  const { currentOrgId } = useAppStore();
  const client = useQueryClient();
  const [type, setType] = useState<AdjustmentType>('REGISTERED_PENSION');
  const [amount, setAmount] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [referenceNumber, setReference] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [problem, setProblem] = useState('');
  const endpoint = `/api/employees/${employeeId}/adjustments`;
  const key = ['employee_adjustments', currentOrgId, employeeId];
  const records = useQuery({ queryKey: key, queryFn: () => apiRequest<{ adjustments: EmployeeAdjustment[] }>(endpoint) });
  const files = useQuery({ queryKey: ['attachments', currentOrgId, 'EMPLOYEE', employeeId], queryFn: () => apiRequest<{ attachments: any[] }>(`/api/attachments?recordType=EMPLOYEE&recordId=${employeeId}`) });
  const refresh = () => { client.invalidateQueries({ queryKey: key }); client.invalidateQueries({ queryKey: ['payroll_adjustments', currentOrgId] }); };
  const save = useMutation({
    mutationFn: () => {
      const amountCents = centsFromAmountText(amount);
      if (amountCents === null) throw new Error('Enter a valid monthly amount.');
      return apiRequest(endpoint, { body: { type, amountCents, validFrom, validTo: validTo || null, referenceNumber, attachmentId: attachmentId || null } });
    },
    onSuccess: () => { setProblem(''); setAmount(''); setReference(''); refresh(); },
    onError: (error: Error) => setProblem(error.message),
  });
  const end = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => apiRequest(`${endpoint}/${id}`, { method: 'PATCH', body: { validTo: date } }),
    onSuccess: refresh,
    onError: (error: Error) => setProblem(error.message),
  });
  return <section className="mt-5 space-y-3 border-t border-border pt-4" aria-label="Employee reliefs and deductions">
    <h3 className="font-semibold text-text">Reliefs and deductions</h3>
    <p className="text-sm text-text-2">Record amounts paid outside this pay run and the evidence for a tax exemption. These adjust PAYE and do not withhold extra cash from salary. Rate limits are sourced reference data marked unverified.</p>
    {problem && <p role="alert" className="text-sm text-negative">{problem}</p>}
    <ul className="space-y-2">
      {(records.data?.adjustments ?? []).map((record) => <li key={record.id} className="rounded-lg border border-border p-3 text-sm">
        <div className="flex justify-between gap-3"><span>{ADJUSTMENT_LABELS[record.type]}</span><Amount cents={record.amountCents} currency="KES" /></div>
        <p className="text-text-2">{record.referenceNumber} · {record.validFrom} to {record.validTo || 'open'}</p>
        {!record.validTo && <label className="mt-2 flex items-center gap-2 text-xs">End after<input aria-label={`End date for ${record.referenceNumber}`} type="date" min={record.validFrom} disabled={end.isPending} onChange={(e) => { if (e.target.value) end.mutate({ id: record.id, date: e.target.value }); }} /></label>}
      </li>)}
    </ul>
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Add relief evidence</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Adjustment type"><select value={type} onChange={(e) => setType(e.target.value as AdjustmentType)}>{ADJUSTMENT_TYPES.map((value) => <option key={value} value={value}>{ADJUSTMENT_LABELS[value]}</option>)}</select></Field>
        <Field label="Monthly amount, KES"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Valid from"><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <Field label="Valid to"><input type="date" value={validTo} min={validFrom} onChange={(e) => setValidTo(e.target.value)} /></Field>
        <Field label="Certificate or policy reference"><input value={referenceNumber} maxLength={100} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Evidence file"><select value={attachmentId} onChange={(e) => setAttachmentId(e.target.value)}><option value="">No file</option>{files.data?.attachments.map((file) => <option key={file.id} value={file.id}>{file.fileName}</option>)}</select></Field>
      </div>
      <button type="button" className={`${buttonClass.primary} mt-3`} disabled={save.isPending || !validFrom || !referenceNumber.trim()} onClick={() => save.mutate()}>Save relief evidence</button>
    </details>
    <AttachmentsPanel recordType="EMPLOYEE" recordId={employeeId} label="Employee evidence files" />
  </section>;
}
