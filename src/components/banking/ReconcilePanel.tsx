import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

/** A signed amount typed by a person: 1,250.00 or -1,250.00 (overdrawn). */
function signedCents(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-') || /^\(.*\)$/.test(trimmed);
  const cents = centsFromAmountText(trimmed.replace(/^-|^\(|\)$/g, ''));
  return cents === null ? null : negative ? -cents : cents;
}

/**
 * Reconciling one bank, cash or M-Pesa account to its statement, as on
 * paper: the statement's date and closing balance, then a tick against each
 * posted line that appears on it, until the ticked lines from the last
 * reconciled balance come to the statement balance.
 */
export function ReconcilePanel() {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const canPost = activeCompany?.role !== 'member';
  const [accountId, setAccountId] = useState('');
  const [statementDate, setStatementDate] = useState(todayIn(activeCompany?.timeZone));
  const [statementBalance, setStatementBalance] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [undoing, setUndoing] = useState<any | null>(null);
  const [reason, setReason] = useState('');

  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => apiRequest('/api/accounts') });
  const moneyAccounts: any[] = (accounts.data?.accounts || []).filter((a: any) => a.isBankAccount && a.isActive !== false);
  const chosenId = accountId || moneyAccounts.find((a) => a.code === '1000')?.id || moneyAccounts[0]?.id || '';
  const chosen = moneyAccounts.find((a) => a.id === chosenId);

  const summary = useQuery({
    queryKey: ['banking_reconciliation', currentOrgId, chosenId],
    queryFn: () => apiRequest<any>(`/api/banking/reconciliation?accountId=${chosenId}`),
    enabled: Boolean(chosenId),
  });
  const history = useQuery({
    queryKey: ['reconciliations', currentOrgId, chosenId],
    queryFn: () => apiRequest<{ reconciliations: any[] }>(`/api/banking/reconciliations?accountId=${chosenId}`),
    enabled: Boolean(chosenId),
  });
  const reconciliations = history.data?.reconciliations || [];
  const underway = reconciliations.find((r) => r.status === 'IN_PROGRESS');
  const lastCompleted = reconciliations.find((r) => r.status === 'COMPLETED');
  const sheet = useQuery({
    queryKey: ['reconciliation-sheet', currentOrgId, underway?.id],
    queryFn: () => apiRequest<any>(`/api/banking/reconciliations/${underway.id}`),
    enabled: Boolean(underway?.id),
  });

  // The ticks start from what is saved each time a worksheet loads.
  useEffect(() => {
    setTicked(sheet.data ? new Set(sheet.data.lines.filter((l: any) => l.cleared).map((l: any) => l.journalLineId)) : null);
  }, [sheet.data]);

  const lines: any[] = sheet.data?.lines || [];
  const figures = useMemo(() => {
    const opening = sheet.data?.reconciliation.openingBalanceCents || 0;
    let moneyIn = 0;
    let moneyOut = 0;
    for (const line of lines) {
      if (!ticked?.has(line.journalLineId)) continue;
      if (line.amountCents > 0) moneyIn += line.amountCents;
      else moneyOut -= line.amountCents;
    }
    const cleared = opening + moneyIn - moneyOut;
    return { opening, moneyIn, moneyOut, cleared, difference: (sheet.data?.reconciliation.statementBalanceCents || 0) - cleared };
  }, [lines, ticked, sheet.data]);

  const refresh = () => {
    for (const key of ['reconciliations', 'reconciliation-sheet', 'banking_reconciliation']) {
      queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
    }
  };

  const start = useMutation({
    mutationFn: () => {
      const balance = signedCents(statementBalance);
      if (!chosenId) throw new Error('Choose the account to reconcile.');
      if (!statementDate) throw new Error('Enter the statement date.');
      if (balance === null) throw new Error('Enter the closing balance on the statement, such as 12,500.00.');
      const opening = !lastCompleted && openingBalance.trim() ? signedCents(openingBalance) : undefined;
      if (opening === null) throw new Error('Enter the opening balance as an amount, or leave it blank.');
      return apiRequest('/api/banking/reconciliations', {
        body: { accountId: chosenId, statementDate, statementBalanceCents: balance, ...(opening !== undefined ? { openingBalanceCents: opening } : {}) },
        fallback: 'The reconciliation could not be started.',
      });
    },
    onSuccess: () => { setProblem(''); setNotice(''); refresh(); },
    onError: (err: Error) => setProblem(err.message),
  });

  const saveTicks = () => apiRequest(`/api/banking/reconciliations/${underway.id}/lines`, {
    method: 'PUT',
    body: { journalLineIds: [...(ticked || [])] },
    fallback: 'The ticks could not be saved.',
  });
  const save = useMutation({
    mutationFn: saveTicks,
    onSuccess: () => { setProblem(''); setNotice('Ticks saved. The reconciliation stays open to finish later.'); refresh(); },
    onError: (err: Error) => setProblem(err.message),
  });
  const finish = useMutation({
    mutationFn: async () => {
      await saveTicks();
      return apiRequest<{ clearedLines: number }>(`/api/banking/reconciliations/${underway.id}/complete`, { body: {}, fallback: 'The reconciliation could not be finished.' });
    },
    onSuccess: (res) => {
      setProblem('');
      setNotice(`${chosen?.name || 'The account'} reconciled to ${shortDate(underway.statementDate)}: ${res.clearedLines} ${res.clearedLines === 1 ? 'line' : 'lines'} cleared, closing at ${figureText(underway.statementBalanceCents)}.`);
      setStatementBalance('');
      setOpeningBalance('');
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });
  const undo = useMutation({
    mutationFn: (target: any) => apiRequest<{ status: string }>(`/api/banking/reconciliations/${target.id}/undo`, {
      body: { reason: reason.trim() || undefined },
      fallback: 'That could not be undone.',
    }),
    onSuccess: (res, target) => {
      setUndoing(null);
      setProblem('');
      setNotice(res.status === 'CANCELLED' ? 'Reconciliation cancelled. Nothing was recorded.' : `The reconciliation to ${shortDate(target.statementDate)} is undone; its lines are uncleared again.`);
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (accounts.isLoading) return <SkeletonRows label="Loading accounts" rows={3} />;
  if (moneyAccounts.length === 0) {
    return <EmptyNote>Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) to reconcile it to its statements.</EmptyNote>;
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Account">
          <select name="reconcileAccount" value={chosenId} onChange={(e) => { setAccountId(e.target.value); setNotice(''); setProblem(''); }}>
            {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {lastCompleted && (
          <p className="pb-2 text-[13px] text-graphite-600">Reconciled to {shortDate(lastCompleted.statementDate)} at <span className="tabular-currency">{figureText(lastCompleted.statementBalanceCents)}</span></p>
        )}
      </div>

      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {problem && !undoing && <p role="alert" className="text-[13.5px] text-ledger-red">{problem}</p>}

      {history.isError ? (
        <LoadProblem what="reconciliations" path="/api/banking/reconciliations" onRetry={() => history.refetch()} />
      ) : history.isLoading ? (
        <SkeletonRows label="Loading reconciliations" rows={3} />
      ) : underway ? (
        sheet.isLoading || !ticked ? <SkeletonRows label="Loading the posted lines" rows={6} /> : (
          <section aria-labelledby="worksheet" className="space-y-3">
            <h3 id="worksheet" className="text-[14px] font-semibold text-ink-900">
              Statement to {shortDate(underway.statementDate)}, closing at <span className="tabular-currency">{figureText(underway.statementBalanceCents)}</span>
            </h3>
            <p className="text-[13px] text-graphite-600">Tick each line that appears on the statement. Lines already matched to imported statement lines start ticked.</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-3">
              <div><dt className="text-graphite-600">Opening balance</dt><dd><Amount cents={figures.opening} currency={currency} tone="ink" /></dd></div>
              <div><dt className="text-graphite-600">Ticked money in</dt><dd><Amount cents={figures.moneyIn} currency={currency} tone="ink" /></dd></div>
              <div><dt className="text-graphite-600">Ticked money out</dt><dd><Amount cents={figures.moneyOut} currency={currency} tone="ink" /></dd></div>
              <div><dt className="text-graphite-600">Cleared balance</dt><dd><Amount cents={figures.cleared} currency={currency} tone="ink" /></dd></div>
              <div><dt className="text-graphite-600">Statement balance</dt><dd><Amount cents={underway.statementBalanceCents} currency={currency} tone="ink" /></dd></div>
              <div>
                <dt className={figures.difference ? 'font-semibold text-ledger-red' : 'font-semibold text-ink-900'}>Difference</dt>
                <dd aria-live="polite"><Amount cents={figures.difference} currency={currency} tone={figures.difference ? 'alert' : 'ink'} className="font-semibold" /></dd>
              </div>
            </dl>
            {lines.length === 0 ? (
              <EmptyNote>Nothing is posted to this account up to the statement date that is not already reconciled.</EmptyNote>
            ) : (
              <ul className="border-t border-feint-strong" aria-label={`Posted lines to ${shortDate(underway.statementDate)}`}>
                {lines.map((line) => (
                  <li key={line.journalLineId} className="border-b border-feint">
                    <label className="grid cursor-pointer grid-cols-[1.5rem_6rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-[13.5px]">
                      <input
                        type="checkbox"
                        checked={ticked.has(line.journalLineId)}
                        disabled={!canPost}
                        onChange={() => toggle(line.journalLineId)}
                        aria-label={`Cleared: ${line.memo || line.description || 'entry'} ${shortDate(line.date)}`}
                      />
                      <span className="tabular-currency text-graphite-600">{shortDate(line.date)}</span>
                      <span className="min-w-0 truncate text-ink-900">
                        {line.memo || line.description || 'Entry'}
                        {line.referenceNo ? <span className="text-graphite-600"> · {line.referenceNo}</span> : null}
                        {line.onStatement ? <span className="text-graphite-600"> · on an imported statement</span> : null}
                      </span>
                      <Amount cents={line.amountCents} currency={currency} tone="ink" />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {canPost && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" className={`${buttonClass.quiet} mr-auto`} onClick={() => setTicked(new Set(lines.map((l) => l.journalLineId)))}>Tick every line</button>
                <button type="button" className={buttonClass.quiet} disabled={undo.isPending} onClick={() => { setReason(''); undo.mutate(underway); }}>Cancel reconciliation</button>
                <button type="button" className={buttonClass.secondary} disabled={save.isPending || finish.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving' : 'Save for later'}</button>
                <button type="button" className={buttonClass.primary} disabled={finish.isPending || figures.difference !== 0} onClick={() => finish.mutate()}>
                  {finish.isPending ? 'Finishing' : 'Finish reconciliation'}
                </button>
              </div>
            )}
            {figures.difference !== 0 && (
              <p className="text-right text-[12.5px] text-graphite-600">Finishing is possible once the difference is nil.</p>
            )}
          </section>
        )
      ) : canPost ? (
        <section aria-labelledby="start-reconciliation" className="space-y-3 border-t border-feint-strong pt-3">
          <h3 id="start-reconciliation" className="text-[14px] font-semibold text-ink-900">Reconcile {chosen?.name || 'the account'} to a statement</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Statement date">
              <input type="date" name="statementDate" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
            </Field>
            <Field label={`Closing balance, ${currency}`} hint="As printed on the statement; negative if overdrawn">
              <input name="statementBalance" inputMode="decimal" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} className="text-right tabular-currency" />
            </Field>
            {!lastCompleted && (
              <Field label={`Opening balance, ${currency}`} hint="Optional, for the first reconciliation only">
                <input name="openingBalance" inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="text-right tabular-currency" />
              </Field>
            )}
          </div>
          <div className="flex justify-end">
            <button type="button" className={buttonClass.primary} disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Starting' : 'Start reconciling'}
            </button>
          </div>
        </section>
      ) : null}

      {summary.data && !underway && (
        <section aria-labelledby="statement-against-ledger" className="space-y-2">
          <h3 id="statement-against-ledger" className="text-[13.5px] font-semibold text-ink-900">Imported statement lines against the ledger</h3>
          <div className="border-t border-feint-strong text-[13.5px]">
            <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2">
              <span className="text-ink-900">All imported lines, net</span>
              <Amount cents={summary.data.statementBalanceCents || 0} currency={currency} tone="ink" />
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2">
              <span className="text-ink-900">Ledger balance, {chosen?.code} {chosen?.name}</span>
              <Amount cents={summary.data.glBalanceCents || 0} currency={currency} tone="ink" />
            </div>
          </div>
          {summary.data.varianceCents === 0
            ? <p className="text-[13px]"><Mark kind="tick" label="The imported lines and the ledger agree to the cent." /></p>
            : <p className="text-[13px] text-graphite-600">They differ by <span className="tabular-currency">{figureText(Math.abs(summary.data.varianceCents))}</span>: some lines are not yet matched, or the statement does not start from the ledger's first entry.</p>}
        </section>
      )}

      {reconciliations.some((r) => r.status !== 'IN_PROGRESS') && (
        <section aria-labelledby="reconciliation-history" className="space-y-2">
          <h3 id="reconciliation-history" className="text-[13.5px] font-semibold text-ink-900">Reconciliations of {chosen?.name || 'this account'}</h3>
          <ul className="border-t border-feint-strong text-[13.5px]">
            {reconciliations.filter((r) => r.status !== 'IN_PROGRESS').map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2">
                <span className={r.status === 'UNDONE' ? 'text-graphite-600 line-through' : 'text-ink-900'}>
                  To {shortDate(r.statementDate)} · closing <span className="tabular-currency">{figureText(r.statementBalanceCents)}</span>
                </span>
                <span className="text-[12.5px] text-graphite-600">
                  {r.status === 'UNDONE' ? `Undone${r.undoReason ? `: ${r.undoReason}` : ''}` : `Finished ${shortDate(r.completedAt?.slice(0, 10))}`}
                  {canPost && r.id === lastCompleted?.id && !underway && (
                    <button type="button" className={`${buttonClass.quiet} ml-3`} onClick={() => { setReason(''); setProblem(''); setUndoing(r); }}>Undo</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={!!undoing}
        onClose={() => { if (!undo.isPending) setUndoing(null); }}
        title={`Undo the reconciliation to ${shortDate(undoing?.statementDate)}`}
        note="Its lines become uncleared again, ready to reconcile once more. Nothing in the ledger changes."
        footer={
          <>
            {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
            <button type="button" onClick={() => setUndoing(null)} className={buttonClass.secondary}>Keep it</button>
            <button type="button" disabled={undo.isPending || !reason.trim()} onClick={() => undo.mutate(undoing)} className={buttonClass.primary}>
              {undo.isPending ? 'Undoing' : 'Undo'}
            </button>
          </>
        }
      >
        <Field label="Reason" hint="For example, the closing balance was mistyped">
          <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
