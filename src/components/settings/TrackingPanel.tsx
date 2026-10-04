import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { useTrackingCategories } from '../common/TagFields';
import { Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

type Kind = 'CLASS' | 'LOCATION';

const COPY: Record<Kind, { title: string; one: string; note: string; example: string }> = {
  CLASS: {
    title: 'Classes',
    one: 'class',
    note: 'A line of business or department, such as Retail, Wholesale or Contracts.',
    example: 'Wholesale',
  },
  LOCATION: {
    title: 'Locations',
    one: 'location',
    note: 'A branch, shop or site, such as Nairobi CBD or Kisumu.',
    example: 'Kisumu branch',
  },
};

/**
 * The organization's classes and locations. Once a list has entries, the
 * forms that post (invoices, bills, expenses, sales receipts, credits and
 * journal entries) offer it, and the profit and loss can be cut by it.
 */
export function TrackingPanel() {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const canEdit = activeCompany?.role !== 'member';
  const categories = useTrackingCategories();
  const [names, setNames] = useState<Record<Kind, string>>({ CLASS: '', LOCATION: '' });
  const [problem, setProblem] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tracking-categories', currentOrgId] });

  const add = useMutation({
    mutationFn: (kind: Kind) => apiRequest('/api/tracking-categories', { body: { kind, name: names[kind].trim() }, fallback: 'It could not be added.' }),
    onSuccess: (_, kind) => { setNames((prev) => ({ ...prev, [kind]: '' })); setProblem(''); refresh(); },
    onError: (err: Error) => setProblem(err.message),
  });
  const toggle = useMutation({
    mutationFn: (category: { id: string; isActive: boolean }) => apiRequest(`/api/tracking-categories/${category.id}`, {
      method: 'PATCH', body: { isActive: !category.isActive }, fallback: 'It could not be changed.',
    }),
    onSuccess: () => { setProblem(''); refresh(); },
    onError: (err: Error) => setProblem(err.message),
  });

  const all = categories.data?.categories || [];

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-[13.5px] leading-relaxed text-ink-900">
        Classes and locations cut the profit and loss two more ways than the chart of accounts. Once a list has entries, every form that posts offers it, and Reports shows profit and loss by class or by location. A void or reversal keeps the class and location of what it reverses.
      </p>
      {problem && <p role="alert" className="text-[13.5px] text-ledger-red">{problem}</p>}
      {(['CLASS', 'LOCATION'] as Kind[]).map((kind) => {
        const list = all.filter((c) => c.kind === kind);
        return (
          <section key={kind} aria-labelledby={`tracking-${kind}`} className="space-y-2">
            <h3 id={`tracking-${kind}`} className="text-[14px] font-semibold text-ink-900">{COPY[kind].title}</h3>
            <p className="text-[13px] text-graphite-600">{COPY[kind].note}</p>
            {list.length > 0 && (
              <ul className="border-t border-feint-strong text-[13.5px]">
                {list.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-1.5">
                    <span className={c.isActive ? 'text-ink-900' : 'text-graphite-600 line-through'}>{c.name}</span>
                    {canEdit && (
                      <button type="button" className={buttonClass.quiet} disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>
                        {c.isActive ? 'Stop using' : 'Use again'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => { e.preventDefault(); if (names[kind].trim()) add.mutate(kind); }}
              >
                <Field label={`New ${COPY[kind].one}`} hint={`For example, ${COPY[kind].example}`}>
                  <input
                    name={`new-${kind.toLowerCase()}`}
                    maxLength={100}
                    value={names[kind]}
                    onChange={(e) => setNames((prev) => ({ ...prev, [kind]: e.target.value }))}
                  />
                </Field>
                <button type="submit" className={buttonClass.secondary} disabled={add.isPending || !names[kind].trim()}>
                  Add {COPY[kind].one}
                </button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
