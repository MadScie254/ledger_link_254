import React from 'react';
import { Trash2, CheckCircle, X, Printer, Download, Sparkles } from 'lucide-react';

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
  entityName = 'items'
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-5 duration-200">
      <div className="bg-ink-900 text-white dark:bg-[#111827] dark:border-ink-900/30 border border-ink-900/20 px-4 py-2.5 rounded-sm shadow-2xl flex items-center space-x-3 text-xs sm:text-sm">
        {/* Selection Count */}
        <div className="flex items-center space-x-2 pr-3 border-r border-white/20">
          <span className="bg-brass-500 text-ink-900 font-bold px-2 py-0.5 rounded-full text-xs">
            {selectedCount}
          </span>
          <span className="font-medium whitespace-nowrap text-slate-200">
            {selectedCount === 1 ? `1 ${entityName.slice(0, -1) || 'item'}` : `${selectedCount} ${entityName}`} selected
          </span>
        </div>

        {/* Status Update Dropdown/Buttons */}
        {statusOptions.length > 0 && onStatusUpdate && (
          <div className="flex items-center space-x-1">
            <span className="text-slate-400 text-xs hidden sm:inline">Set status:</span>
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onStatusUpdate(opt.value)}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Export / Print */}
        {onExport && (
          <button
            onClick={onExport}
            disabled={isLoading}
            className="flex items-center space-x-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-sm font-medium transition-colors disabled:opacity-50"
            title="Export Selected"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        )}

        {onPrint && (
          <button
            onClick={onPrint}
            disabled={isLoading}
            className="flex items-center space-x-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-sm font-medium transition-colors disabled:opacity-50"
            title="Print Selected"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Print</span>
          </button>
        )}

        {/* Batch Delete */}
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={isLoading}
            className="flex items-center space-x-1 px-3 py-1 bg-rust-700 hover:bg-rust-800 text-white rounded-sm font-bold transition-colors disabled:opacity-50"
            title="Delete Selected"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}

        {/* Clear Selection */}
        <button
          onClick={onClearSelection}
          className="p-1 hover:bg-white/10 rounded-sm text-slate-400 hover:text-white transition-colors ml-1"
          title="Clear Selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
