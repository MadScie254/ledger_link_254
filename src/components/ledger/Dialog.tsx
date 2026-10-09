import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Open dialogs, oldest first. Only the last one listens for Escape and Tab,
 * so a receipt reader opened over a bill closes on its own.
 */
const openLayers: HTMLElement[] = [];
const INERT_MARK = 'data-dialog-inert';

/** Everything on the page except the topmost dialog is made inert. */
function syncInert() {
  const top = openLayers[openLayers.length - 1];
  for (const el of Array.from(document.body.children)) {
    if (!(el instanceof HTMLElement)) continue;
    const shouldBeInert = !!top && el !== top;
    if (shouldBeInert && !el.hasAttribute('inert')) {
      el.setAttribute('inert', '');
      el.setAttribute(INERT_MARK, '');
    } else if (!shouldBeInert && el.hasAttribute(INERT_MARK)) {
      el.removeAttribute('inert');
      el.removeAttribute(INERT_MARK);
    }
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A focused sheet over the workspace. */
export function Dialog({
  open,
  onClose,
  title,
  note,
  children,
  footer,
  width = 'md',
  placement = 'center',
  showCloseButton = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'center' | 'right';
  showCloseButton?: boolean;
}) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    const sheet = sheetRef.current;
    if (!layer || !sheet) return;

    const returnFocus = document.activeElement as HTMLElement | null;
    openLayers.push(layer);
    syncInert();

    const first = sheet.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button:not([data-dialog-close])');
    (first || sheet).focus();

    const onKey = (e: KeyboardEvent) => {
      if (openLayers[openLayers.length - 1] !== layer) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        sheet.focus();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || !sheet.contains(document.activeElement))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (document.activeElement === lastEl || !sheet.contains(document.activeElement))) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const index = openLayers.indexOf(layer);
      if (index >= 0) openLayers.splice(index, 1);
      syncInert();
      returnFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div
      ref={layerRef}
      className={`ll-layer fixed inset-0 z-[70] flex bg-black/50 ${placement === 'right' ? 'justify-end' : 'items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full border border-border bg-surface shadow-lg focus:outline-none ${placement === 'right' ? 'll-drawer flex h-full max-w-[38rem] flex-col rounded-l-2xl' : `my-auto ${widths[width]} rounded-2xl`}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="ll-heading text-[22px] leading-7 text-text">{title}</h2>
            {note && <p className="mt-1 text-[14px] leading-5 text-text-2">{note}</p>}
          </div>
          {showCloseButton && (
            <button type="button" data-dialog-close onClick={onClose} aria-label="Close" className="-mr-2 rounded-md p-2 text-text-2 hover:bg-hover hover:text-text">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={`px-6 py-5 ${placement === 'right' ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>{children}</div>
        {footer && <div className={`flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-6 py-4 ${placement === 'right' ? 'rounded-bl-2xl' : 'rounded-b-2xl'}`}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A labelled field with space for guidance and validation. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] leading-4 font-medium text-text-2">{label}</span>
      <span className="mt-1.5 block [&>input]:w-full [&>select]:w-full [&>textarea]:w-full [&>input]:h-9 [&>select]:h-9 [&>input]:px-3 [&>select]:px-2.5 [&>textarea]:px-3 [&>textarea]:py-2 [&>input]:border [&>select]:border [&>textarea]:border [&>input]:text-[14px] [&>select]:text-[14px] [&>textarea]:text-[14px]">
        {children}
      </span>
      {hint && !error && <span className="mt-1 block text-[12.5px] text-text-3">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-[12.5px] text-negative">
          {error}
        </span>
      )}
    </label>
  );
}
