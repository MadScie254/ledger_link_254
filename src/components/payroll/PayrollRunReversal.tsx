import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

/**
 * Reverses a posted pay run that was wrong: a dated reversing entry undoes
 * its journal, the payslips stay on record marked reversed, and the month is
 * free for a corrected run.
 */
export function PayrollRunReversal({ run }: { run: { id: string; period: string; payDate: string; reversedAt: string | null; reversalReason: string | null } }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reversalDate, setReversalDate] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  const reverse = useMutation({
    mutationFn: () => apiRequest(`/api/payroll/runs/${run.id}/reverse`, {
      body: { reversalDate, reason: reason.trim() },
      fallback: 'The pay run could not be reversed.',
    }),
    onSuccess: () => {
      setNotice(`${run.period} reversed on ${format(new Date(reversalDate), 'dd/MM/yyyy')}. Run the month again to post the corrected payroll.`);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['payroll_runs', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentOrgId] });
    },
  });

  if (run.reversedAt) {
    return (
      <p className="text-[13.5px] text-ink-900">
        Reversed on {format(new Date(run.reversedAt), 'dd/MM/yyyy')}{run.reversalReason ? `: ${run.reversalReason}` : ''}. These payslips are kept for the record and are not owed.
      </p>
    );
  }
  if (activeCompany?.role === 'member') return null;

  return (
    <div className="space-y-3">
      {!open && (
        <button
          type="button"
          className={buttonClass.quiet}
          onClick={() => {
            setNotice('');
            reverse.reset();
            setReversalDate(todayIn(activeCompany?.timeZone));
            setReason('');
            setOpen(true);
          }}
        >
          Reverse this pay run
        </button>
      )}
      {open && (
        <form
          className="max-w-2xl space-y-3 border border-field p-3"
          onSubmit={(e) => {
            e.preventDefault();
            reverse.mutate();
          }}
        >
          <p className="text-[13.5px] text-ink-900">
            Reverse the {run.period} run paid on {format(new Date(run.payDate), 'dd/MM/yyyy')}? Salaries, PAYE, NSSF, SHA and Housing Levy for it are taken back out of the books on the date below.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label="Reversal date">
              <input type="date" required min={run.payDate} value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} />
            </Field>
            <Field label="Reason" hint="For example, wrong salary for one employee">
              <input type="text" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          {reverse.isError && <p role="alert" className="text-[13px] text-ledger-red">{reverse.error.message}</p>}
          <div className="flex gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>Keep the run</button>
            <button type="submit" className={buttonClass.secondary} disabled={reverse.isPending || !reason.trim()}>
              {reverse.isPending ? 'Reversing' : 'Reverse pay run'}
            </button>
          </div>
        </form>
      )}
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
    </div>
  );
}
