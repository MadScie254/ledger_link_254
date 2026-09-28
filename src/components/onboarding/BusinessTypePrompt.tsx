import { useState } from 'react';
import { Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import { BUSINESS_TYPES, type BusinessType } from '../../utils/businessTypes';

/**
 * Asked once, right after a company first has books to open (never before:
 * OnboardingProvider only mounts this once `activeCompany` exists). Picking a
 * type seeds a few extra accounts for that kind of work and lets the tour
 * skip the pages that do not apply. Closing this any way, Escape, backdrop,
 * or "Not sure yet", counts as "Something else": it never reappears, and the
 * choice can be changed later from Settings.
 */
export function BusinessTypePrompt() {
  const { currentOrgId, activeCompany, setActiveCompany } = useAppStore();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<BusinessType | null>(null);
  const [problem, setProblem] = useState('');

  const choose = async (businessType: BusinessType) => {
    if (saving) return;
    setSaving(businessType);
    setProblem('');
    try {
      const response = await fetch(`/api/organizations/${currentOrgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType }),
      });
      if (!response.ok) throw new Error('The business type could not be saved.');
      if (activeCompany) setActiveCompany({ ...activeCompany, businessType });
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    } catch (err: any) {
      setProblem(err.message || 'The business type could not be saved.');
      setSaving(null);
    }
  };

  return (
    <Dialog
      open
      onClose={() => choose('general')}
      title="What kind of business is this?"
      note="This starts you with a few extra accounts for the way your business works, and skips tour pages that do not apply. Change it anytime from Settings."
      width="sm"
      showCloseButton={false}
      footer={
        <button type="button" onClick={() => choose('general')} disabled={!!saving} className={buttonClass.quiet}>
          Not sure yet
        </button>
      }
    >
      {problem && <p role="alert" className="mb-3 text-[13px] text-ledger-red">{problem}</p>}
      <ul className="border-t border-feint-strong">
        {BUSINESS_TYPES.filter((type) => type.id !== 'general').map((type) => (
          <li key={type.id} className="border-b border-feint">
            <button
              type="button"
              onClick={() => choose(type.id)}
              disabled={!!saving}
              className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-paper-200 disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-900">{type.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-graphite-600">{type.description}</span>
              </span>
              {saving === type.id ? (
                <span className="ll-printed shrink-0 pt-0.5 text-[10.5px] text-graphite-600">Saving</span>
              ) : (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-transparent" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
