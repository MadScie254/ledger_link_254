import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';

export interface DataColumn<T> {
  id: string;
  label: string;
  value: (record: T) => string | number | null | undefined;
  render: (record: T) => React.ReactNode;
  numeric?: boolean;
}

export interface DataTableProps<T extends { id: string }> {
  records: T[];
  columns: DataColumn<T>[];
  caption: string;
  onOpen: (record: T) => void;
  openLabel: (record: T) => string;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  selectAllLabel?: string;
  selectRowLabel?: (record: T) => string;
  rowActions?: (record: T) => React.ReactNode;
  mobile?: {
    primary: (record: T) => React.ReactNode;
    secondary: (record: T) => React.ReactNode;
    amount: (record: T) => React.ReactNode;
    status?: (record: T) => React.ReactNode;
  };
}

/** One sorted, selectable table for record lists. Callers own filters and mutations. */
export function DataTable<T extends { id: string }>({
  records, columns, caption, onOpen, openLabel, selectedIds, onSelectionChange,
  selectAllLabel, selectRowLabel, rowActions, mobile,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [compact, setCompact] = useState(false);
  const definitions = useMemo<ColumnDef<T>[]>(() => columns.map((column) => ({
    id: column.id,
    accessorFn: column.value,
    header: column.label,
    cell: ({ row }) => column.render(row.original),
    sortingFn: column.numeric ? 'basic' : 'alphanumeric',
  })), [columns]);
  const table = useReactTable({ data: records, columns: definitions, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (row) => row.id });
  const rows = table.getRowModel().rows;
  const allSelected = records.length > 0 && records.every((record) => selectedIds?.includes(record.id));
  const someSelected = !allSelected && records.some((record) => selectedIds?.includes(record.id));
  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds || []);
    for (const record of records) checked ? next.add(record.id) : next.delete(record.id);
    onSelectionChange?.([...next]);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds || []);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange?.([...next]);
  };

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium text-text-2">{records.length} {records.length === 1 ? 'record' : 'records'}</span>
        <button type="button" onClick={() => setCompact((value) => !value)} aria-pressed={compact} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary">
          {compact ? 'Comfortable rows' : 'Compact rows'}
        </button>
      </div>
      {mobile && (
        <ul className="divide-y divide-border sm:hidden" aria-label={caption}>
          {rows.map((row) => {
            const record = row.original;
            return <li key={row.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => onOpen(record)} className="min-w-0 text-left text-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-primary">{mobile.primary(record)}</button>
                <span className="shrink-0">{mobile.amount(record)}</span>
              </div>
              <div className="mt-1 text-xs text-text-2">{mobile.secondary(record)}</div>
              {(mobile.status || rowActions || onSelectionChange) && <div className="mt-2 flex flex-wrap items-center gap-3">
                {mobile.status?.(record)}
                {rowActions?.(record)}
                {onSelectionChange && <label className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-xs text-text-2"><input type="checkbox" checked={!!selectedIds?.includes(record.id)} onChange={() => toggleOne(record.id)} aria-label={selectRowLabel?.(record) || `Select ${openLabel(record)}`} />Select</label>}
              </div>}
            </li>;
          })}
        </ul>
      )}
      <div className={`${mobile ? 'hidden sm:block ' : ''}overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-[12px] font-semibold text-text-2">
            <tr>
              {onSelectionChange && <th scope="col" className="w-10 px-3 py-2.5 text-left"><input type="checkbox" aria-label={selectAllLabel || 'Select all rows'} checked={allSelected} ref={(input) => { if (input) input.indeterminate = someSelected; }} onChange={(event) => toggleAll(event.target.checked)} /></th>}
              {table.getHeaderGroups()[0]?.headers.map((header, index) => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'} className={`px-3 py-2.5 ${columns[index].numeric ? 'text-right' : 'text-left'}`}>
                <button type="button" onClick={header.column.getToggleSortingHandler()} className={`inline-flex items-center gap-1 rounded text-xs font-semibold text-text-2 hover:text-text focus-visible:outline-2 focus-visible:outline-primary ${columns[index].numeric ? 'flex-row-reverse' : ''}`}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === 'asc' ? <ChevronUp className="size-3.5" aria-hidden="true" /> : header.column.getIsSorted() === 'desc' ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />}
                </button>
              </th>)}
              {rowActions && <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => <tr key={row.id} tabIndex={0} aria-label={openLabel(row.original)} onClick={() => onOpen(row.original)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(row.original); } }} className={`group cursor-pointer hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${compact ? 'h-9' : 'h-12'}`}>
              {onSelectionChange && <td className="px-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={selectRowLabel?.(row.original) || `Select ${openLabel(row.original)}`} checked={!!selectedIds?.includes(row.id)} onChange={() => toggleOne(row.id)} /></td>}
              {row.getVisibleCells().map((cell, index) => <td key={cell.id} className={`px-3 ${columns[index].numeric ? 'text-right tabular-nums' : 'text-left'}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
              {rowActions && <td className="px-3 text-right" onClick={(event) => event.stopPropagation()}><div className="inline-flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">{rowActions(row.original)}</div></td>}
            </tr>)}
          </tbody>
        </table>
      </div>
      {records.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-2">No records match this filter. Choose All to see every record.</p>}
    </div>
  );
}
