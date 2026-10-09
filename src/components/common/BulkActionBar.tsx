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
 * Contextual actions for selected records.
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
  const action = 'min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-[13px] font-medium text-text hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 whitespace-nowrap sm:min-h-9';

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2" role="region" aria-label="Actions for selected rows">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-strong bg-surface px-3 py-2 shadow-lg">
        <p className="mr-1 whitespace-nowrap text-[13.5px] text-text" aria-live="polite">
          <span className="font-display font-bold tabular-nums">{selectedCount}</span> {noun} selected
          {totalCount ? <span className="text-text-2"> of {totalCount}</span> : null}
        </p>

        {statusOptions.length > 0 && onStatusUpdate && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="hidden text-[12.5px] text-text-2 sm:inline">Mark as</span>
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
          <button type="button" onClick={onDelete} disabled={isLoading} className="min-h-11 rounded-lg border border-negative bg-negative-soft px-3 text-[13px] font-semibold text-negative hover:bg-negative hover:text-white focus-visible:outline-2 focus-visible:outline-negative disabled:opacity-50 sm:min-h-9">
            Delete
          </button>
        )}

        <button type="button" onClick={onClearSelection} aria-label="Clear selection" className="ml-auto rounded-lg p-2 text-text-2 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-primary">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
