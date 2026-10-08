/**
 * A document as it is printed: an invoice, credit note, estimate, sales
 * receipt, sales order or purchase order, already laid out in words and
 * figures. The Worker builds it from the books (src/server/documentPrint.ts)
 * and the browser turns it into a PDF (./documentPdf.ts), so the PDF never
 * works anything out for itself.
 */

export const PRINT_KINDS = ['invoice', 'credit-note', 'estimate', 'sales-receipt', 'sales-order', 'purchase-order'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export interface PrintParty {
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  kraPin: string | null;
  email: string | null;
  phone: string | null;
}

export interface PrintLine {
  description: string;
  quantity: number | null;
  unitPriceCents: number | null;
  /** VAT rate in percent, or null when there is no amount to rate. */
  taxRate: number | null;
  amountCents: number;
  taxCents: number;
}

export interface PrintTotal {
  label: string;
  cents: number;
  /** The total ruled above and below, or the balance carried to the customer. */
  emphasis?: 'total' | 'balance';
}

export interface PrintDocument {
  kind: PrintKind;
  /** "Invoice", "Tax invoice" once eTIMS has signed it, "Credit note", ... */
  title: string;
  number: string;
  currency: string;
  /** Stamped across the page. */
  stamp: 'VOID' | 'CANCELLED' | 'PAID' | null;
  /** The company's own accent colour, as #RRGGBB. */
  accent: string;
  company: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  /** "Bill to", "Credit to", "Received from", "Supplier". */
  partyLabel: string;
  party: PrintParty | null;
  /** Dates (dd/MM/yyyy) and references, printed beside the party. */
  facts: Array<{ label: string; value: string }>;
  priceLabel: 'Unit price' | 'Unit cost';
  lines: PrintLine[];
  totals: PrintTotal[];
  notes: string | null;
  /** How to pay: only on documents the customer will pay from. */
  paymentDetails: string | null;
  footer: string | null;
  /** Printed only once KRA's eTIMS has signed the invoice. */
  etims: { controlCode: string; qrCodeUrl: string | null } | null;
}

/** 2026-09-02 as 02/09/2026. */
export function printedDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * The VAT rate a line was charged at, from its amount and VAT: the whole
 * percent that gives exactly that VAT once rounded to the cent (16, 8, 0),
 * or the rate to two places when no whole percent does.
 */
export function rateOf(amountCents: number, taxCents: number): number | null {
  if (!amountCents) return taxCents ? null : 0;
  const whole = Math.round((taxCents * 100) / amountCents);
  if (Math.round((amountCents * whole) / 100) === taxCents) return whole;
  return Math.round((taxCents * 10000) / amountCents) / 100;
}

/** 116000 as 1,160.00; never a locale's own separators, so a PDF reads the same everywhere. */
export function printedMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** 2 as 2, 2.5 as 2.5, 0.125 as 0.125. */
export function printedQuantity(quantity: number | null): string {
  if (quantity == null) return '';
  return String(Math.round(quantity * 1000) / 1000);
}

/** Invoice-INV-0001.pdf */
export function printFileName(document: Pick<PrintDocument, 'title' | 'number'>): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe(document.title)}-${safe(document.number)}.pdf`;
}

// Code points the PDF fonts lack, and what to draw instead.
const LATIN1_STANDINS = new Map<number, string>([
  [0x2018, "'"], [0x2019, "'"], [0x201a, "'"], [0x201b, "'"],
  [0x201c, '"'], [0x201d, '"'], [0x201e, '"'],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'], [0x2014, '-'], [0x2212, '-'],
  [0x2026, '...'], [0x2022, String.fromCharCode(0xb7)],
  [0x2007, ' '], [0x2009, ' '], [0x200a, ' '], [0x202f, ' '],
  [0x200b, ''], [0x200d, ''], [0xfeff, ''],
  [0x20ac, 'EUR'], [0x2122, 'TM'],
]);

/**
 * Text the PDF's built-in fonts can draw. They cover Latin-1 only, and a
 * single character outside it turns the whole line to blanks, so curly quotes
 * and dashes become plain ones, accented letters lose an accent they cannot
 * carry, and anything else becomes "?".
 */
export function latin1(text: string): string {
  return text.replace(/[^\x00-\xFF]/gu, (character) => LATIN1_STANDINS.get(character.codePointAt(0)!)
    ?? (character.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x00-\xFF]/gu, '') || '?'));
}
