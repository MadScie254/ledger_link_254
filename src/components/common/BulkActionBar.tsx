import { X } from 'lucide-react';

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount?: number;
  onClearSelection: () => void;
  onDelete?: () => void;
  statusOptions?: Array<{ label: string; value: string }>;
  onStatusUpdate?: (status: string) => void;
  onExport?: () => void;
  onPrint?: () => void;
  isLoading?: boolean;
  entityName?: string;
}

/**
 * A slip laid over the foot of the page while rows are selected. It appears
 * instantly, like the selection that summons it.
 */
export function BulkActionBar({
  selectedCount,
  totalCount,
  onClearSelection,
  onDelete,
  statusOptions = [],
  onStatusUpdate,
  onExport,
  onPrint,
  isLoading = false,
  entityName = 'items',
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const noun = selectedCount === 1 ? entityName.replace(/s$/, '') || 'item' : entityName;
  const action = 'h-8 px-2.5 text-[13px] text-ink-900 border border-field hover:border-ink-900 disabled:opacity-50 whitespace-nowrap';

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2" role="region" aria-label="Actions for selected rows">
      <div className="ll-lift flex flex-wrap items-center gap-x-3 gap-y-2 border border-feint-strong border-t-2 border-t-ink-900 bg-paper-100 px-3 py-2">
        <p className="mr-1 text-[13.5px] text-ink-900 whitespace-nowrap" aria-live="polite">
          <span className="ll-figure font-semibold">{selectedCount}</span> {noun} selected
          {totalCount ? <span className="text-graphite-600"> of {totalCount}</span> : null}
        </p>

        {statusOptions.length > 0 && onStatusUpdate && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="hidden text-[12.5px] text-graphite-600 sm:inline">Mark as</span>
            {statusOptions.map((opt) => (
              <button key={opt.value} type="button" onClick={() => onStatusUpdate(opt.value)} disabled={isLoading} className={action}>
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {onExport && (
          <button type="button" onClick={onExport} disabled={isLoading} className={action}>
            Export
          </button>
        )}

        {onPrint && (
          <button type="button" onClick={onPrint} disabled={isLoading} className={action}>
            Print
          </button>
        )}

        {onDelete && (
          <button type="button" onClick={onDelete} disabled={isLoading} className="h-8 px-2.5 text-[13px] font-semibold text-ledger-red border border-ledger-red hover:bg-ledger-red hover:text-white disabled:opacity-50">
            Delete
          </button>
        )}

        <button type="button" onClick={onClearSelection} aria-label="Clear selection" className="ml-auto p-1 text-graphite-600 hover:text-ink-900">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
