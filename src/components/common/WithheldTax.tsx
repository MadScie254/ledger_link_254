import { centsFromAmountText } from '../../utils/salesOrders';
import { Field } from '../ledger/Dialog';

export interface Withheld {
  on: boolean;
  wht: string;
  whtCertificate: string;
  wvat: string;
  wvatCertificate: string;
}

export const NO_WITHHOLDING: Withheld = { on: false, wht: '', whtCertificate: '', wvat: '', wvatCertificate: '' };

/** The withheld amounts in cents, and a sentence when one cannot be read. */
export function withheldCents(value: Withheld): { whtCents: number; wvatCents: number; problem: string | null } {
  if (!value.on) return { whtCents: 0, wvatCents: 0, problem: null };
  const wht = value.wht.trim() ? centsFromAmountText(value.wht) : 0;
  const wvat = value.wvat.trim() ? centsFromAmountText(value.wvat) : 0;
  if (wht === null || wvat === null) return { whtCents: 0, wvatCents: 0, problem: 'Enter tax withheld as an amount, such as 2500 or 2,500.00.' };
  return { whtCents: wht, wvatCents: wvat, problem: null };
}

/**
 * Income tax and VAT withheld at payment, entered from the KRA certificates.
 * No rate is applied: the amounts are what was actually withheld.
 */
export function WithheldTaxFields({ value, onChange, currency, side }: {
  value: Withheld; onChange: (value: Withheld) => void; currency: string; side: 'customer' | 'business';
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-[13.5px]">
        <input type="checkbox" className="mt-1" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} name="taxWithheld" />
        <span>{side === 'customer' ? 'The customer withheld tax and paid the rest' : 'Tax was withheld from this payment for KRA'}</span>
      </label>
      {value.on && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Income tax withheld (${currency})`} hint="From the withholding tax certificate.">
            <input inputMode="decimal" value={value.wht} onChange={(e) => onChange({ ...value, wht: e.target.value })} name="whtAmount" />
          </Field>
          <Field label="Certificate number" hint={side === 'customer' ? 'Required when tax was withheld.' : 'Optional until KRA issues it.'}>
            <input maxLength={100} value={value.whtCertificate} onChange={(e) => onChange({ ...value, whtCertificate: e.target.value })} name="whtCertificate" />
          </Field>
          <Field label={`VAT withheld (${currency})`} hint="Only by an appointed withholding VAT agent.">
            <input inputMode="decimal" value={value.wvat} onChange={(e) => onChange({ ...value, wvat: e.target.value })} name="wvatAmount" />
          </Field>
          <Field label="Certificate number">
            <input maxLength={100} value={value.wvatCertificate} onChange={(e) => onChange({ ...value, wvatCertificate: e.target.value })} name="wvatCertificate" />
          </Field>
        </div>
      )}
    </div>
  );
}
