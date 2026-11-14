import { format, setDate, differenceInCalendarDays, isToday } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { useAppStore } from '../../store';
import { buttonClass } from '../ledger/Page';

/**
 * Statutory obligations for Kenya — deadlines are sourced from PRODUCT.md.
 * This is a summary hub view: no backend data yet. Status pills show how close
 * each deadline is; "Filed" is not shown until filing status is tracked.
 */

type DeadlineDay = 9 | 20;

interface Obligation {
  id: string;
  name: string;
  deadlineLabel: string;
  deadlineDay: DeadlineDay;
  note: 'payroll' | 'vat';
  source: string;
}

/** All figures sourced from PRODUCT.md — PAYE, NSSF and SHIF by the 9th; Housing Levy by the ninth working day; VAT by the 20th. */
const OBLIGATIONS: Obligation[] = [
  {
    id: 'paye',
    name: 'PAYE',
    deadlineLabel: 'By the 9th of each month',
    deadlineDay: 9,
    note: 'payroll',
    source: 'Kenya Revenue Authority — Income Tax Act',
  },
  {
    id: 'nssf',
    name: 'NSSF',
    deadlineLabel: 'By the 9th of each month',
    deadlineDay: 9,
    note: 'payroll',
    source: 'National Social Security Fund Act, 2013',
  },
  {
    id: 'shif',
    name: 'SHIF',
    deadlineLabel: 'By the 9th of each month',
    deadlineDay: 9,
    note: 'payroll',
    source: 'Social Health Insurance Fund (formerly NHIF) — Social Health Insurance Act, 2023',
  },
  {
    id: 'housing-levy',
    name: 'Housing Levy',
    deadlineLabel: 'By the 9th working day of each month',
    deadlineDay: 9,
    note: 'payroll',
    source: 'Affordable Housing Act — Kenya Revenue Authority administration',
  },
  {
    id: 'vat',
    name: 'VAT',
    deadlineLabel: 'By the 20th of each month',
    deadlineDay: 20,
    note: 'vat',
    source: 'Kenya Revenue Authority — Value Added Tax Act',
  },
];

type PillStatus = 'upcoming' | 'due-soon' | 'overdue';

function getStatus(deadline: Date, today: Date): PillStatus {
  const daysUntil = differenceInCalendarDays(deadline, today);
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 5) return 'due-soon';
  return 'upcoming';
}

function formatDaysRemaining(deadline: Date, today: Date): string {
  if (isToday(deadline)) return 'today';
  const diff = differenceInCalendarDays(deadline, today);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
  if (diff === 1) return 'tomorrow';
  return `${diff} days`;
}

const STATUS_CONFIG: Record<PillStatus, { label: string; pill: string }> = {
  upcoming: {
    label: 'Upcoming',
    pill: 'bg-neutral-soft text-text-2',
  },
  'due-soon': {
    label: 'Due soon',
    pill: 'bg-warning-soft text-warning',
  },
  overdue: {
    label: 'Overdue',
    pill: 'bg-negative-soft text-negative',
  },
};

interface ObligationCardProps {
  obligation: Obligation;
  today: Date;
  onNavigateToVat?: () => void;
}

function ObligationCard({ obligation, today, onNavigateToVat }: ObligationCardProps) {
  const deadline = setDate(today, obligation.deadlineDay);
  const status = getStatus(deadline, today);
  const cfg = STATUS_CONFIG[status];
  const daysLabel = formatDaysRemaining(deadline, today);
  const isHousingLevy = obligation.id === 'housing-levy';

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-text">{obligation.name}</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <p className="mt-1 text-[13px] text-text-2">{obligation.deadlineLabel}</p>

      <p className="mt-3 text-[13.5px] text-text">
        <span className="font-medium">{format(deadline, 'd MMMM yyyy')}</span>
        <span className="ml-1.5 text-text-2">({daysLabel})</span>
      </p>

      {isHousingLevy && (
        <p className="mt-1 text-[12px] text-text-2">
          Exact date may vary with public holidays.
        </p>
      )}

      <div className="mt-3 border-t border-border pt-3">
        {obligation.note === 'payroll' ? (
          <p className="text-[13px] text-text-2">Run payroll to generate figures.</p>
        ) : (
          <button
            type="button"
            onClick={onNavigateToVat}
            className={`${buttonClass.quiet} -ml-2 text-[13px]`}
          >
            View VAT and eTIMS summary
          </button>
        )}
      </div>

      <p className="mt-2 text-[11.5px] text-text-2 opacity-70">Source: {obligation.source}</p>
    </div>
  );
}

export function StatutoryReturnsView({
  onBack,
  onNavigateToReport,
}: {
  onBack: () => void;
  onNavigateToReport?: (id: string) => void;
}) {
  const { activeCompany } = useAppStore();
  const today = new Date();
  const monthLabel = format(today, 'MMMM yyyy');

  return (
    <div className="space-y-5 pb-16">
      <button type="button" onClick={onBack} className={`${buttonClass.quiet} no-print`}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Reports
      </button>

      <header className="flex flex-col gap-1 pb-2">
        <h1 className="ll-heading text-[22px] leading-7 text-text">Statutory obligations</h1>
        <p className="text-[14px] leading-5 text-text-2">
          {activeCompany?.legalName || activeCompany?.name || 'Your organization'} · {monthLabel}
        </p>
      </header>

      <p className="text-[13.5px] text-text-2">
        Filing deadlines for Kenya statutory returns this month. Deadline dates are computed from
        today and do not account for public holidays.
      </p>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Statutory filing obligations">
        {OBLIGATIONS.map((obligation) => (
          <li key={obligation.id}>
            <ObligationCard
              obligation={obligation}
              today={today}
              onNavigateToVat={
                obligation.note === 'vat'
                  ? () => {
                      onBack();
                      onNavigateToReport?.('Tax Summary (KRA VAT & eTIMS)');
                    }
                  : undefined
              }
            />
          </li>
        ))}
      </ul>

      <p className="text-[12.5px] text-text-2">
        PAYE, NSSF and SHIF are due by the 9th of each month. The Housing Levy is due by the 9th
        working day, which may differ from the 9th calendar day when public holidays fall in that
        window. VAT is due by the 20th of the month following the return period.
      </p>
    </div>
  );
}
