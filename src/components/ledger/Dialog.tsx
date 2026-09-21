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

/**
 * A sheet lifted over the page: the one place the book casts a shadow.
 *
 * No entrance animation (selection and opening are instant in this world).
 * The sheet is portalled to the body with the rest of the page made inert, so
 * focus cannot wander behind it. Escape and the backdrop close it; focus moves
 * into the sheet on open and returns to whatever opened it on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  note,
  children,
  footer,
  width = 'md',
  showCloseButton = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
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
      className="ll-layer fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:items-center sm:p-6"
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
        className={`relative my-auto w-full ${widths[width]} border border-feint-strong bg-paper-100 ll-lift focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink-900 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="ll-heading text-[22px] leading-tight text-ink-900">{title}</h2>
            {note && <p className="mt-1 text-[13px] text-graphite-600">{note}</p>}
          </div>
          {showCloseButton && (
            <button type="button" data-dialog-close onClick={onClose} aria-label="Close" className="-mr-1 p-1 text-graphite-600 hover:text-ink-900">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-feint px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A labelled field in the book's form vocabulary. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-ink-900">{label}</span>
      <span className="mt-1.5 block [&>input]:w-full [&>select]:w-full [&>textarea]:w-full [&>input]:h-10 [&>select]:h-10 [&>input]:px-3 [&>select]:px-2.5 [&>textarea]:px-3 [&>textarea]:py-2 [&>input]:border [&>select]:border [&>textarea]:border [&>input]:text-[14px] [&>select]:text-[14px] [&>textarea]:text-[14px]">
        {children}
      </span>
      {hint && !error && <span className="mt-1 block text-[12.5px] text-graphite-600">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-[12.5px] text-ledger-red">
          {error}
        </span>
      )}
    </label>
  );
}
