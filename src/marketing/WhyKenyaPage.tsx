import { ProsePage } from './ProsePage';

/**
 * FORWARD-LOOKING COPY — see the same note in LandingPage.tsx.
 * Not shipped yet, but written here in the present tense:
 *   - Daraja C2B/B2C polling on a fifteen-minute cycle  (section 3.3)
 *   - statutory rates keyed by effective-from date      (section 3.4)
 *   - WhatsApp Business invoice delivery and reconciliation (section 3.6)
 * The eTIMS paragraph is accurate today.
 */
export function WhyKenyaPage() {
  return (
    <ProsePage
      title="What being built for Kenya actually changes"
      standfirst="Every accounting package sold here claims local support. That usually means a currency symbol and a reseller. Here is the specific list of things that are different when the software is written against Kenyan rules rather than localised into them."
    >
      <h2>M-Pesa is a payment rail, not a bank import</h2>
      <p>
        In most systems a till is modelled as a bank account and fed by a monthly statement export.
        That loses the counterparty phone number, loses the transaction reference customers quote
        on invoices, and puts a four-week gap between money arriving and the ledger knowing about
        it. Ledger Link talks to the Daraja C2B and B2C endpoints on a fifteen-minute cycle, keeps
        the raw callback payload alongside the parsed transaction so a reconciliation miss can be
        debugged rather than guessed at, and matches against open invoices on the reference.
      </p>

      <h2>Statutory deductions change mid-year, and the software has to cope</h2>
      <p>
        The Housing Levy arrived in 2023, SHIF replaced NHIF in 2024, and the NSSF tiers have been
        stepping up on a published schedule since 2013. A payroll engine that hardcodes a rate is
        wrong within a year. Rates here live in a table with an effective-from date on every row,
        so a June run uses June rates and a corrected March run uses March rates, without anyone
        editing code or maintaining two versions of the system.
      </p>

      <h2>VAT is filed against a PIN, on a form, on a deadline</h2>
      <p>
        The tax summary produces the figures in the shape the KRA return asks for, with the
        supporting transaction list behind each number. eTIMS invoices are generated and queued
        with the fields the Type C specification requires. What Ledger Link cannot do is submit
        them for you without your own OSCU or VSCU device registration, because KRA issues those
        against your PIN and there is no way around that. The queue is visible so you can see
        exactly what is waiting.
      </p>

      <h2>Your customers pay from a phone, so your invoice should arrive on one</h2>
      <p>
        Emailing a PDF to a customer who runs their business on WhatsApp is a request to be
        ignored. Invoices can go out as a WhatsApp Business message carrying the invoice number,
        the amount due, a payment link that opens an M-Pesa prompt, and the PDF attached for the
        accountant. When the Daraja webhook confirms payment, the invoice is reconciled and the
        customer gets a confirmation on the same thread. This is the workflow a foreign vendor
        structurally cannot ship here.
      </p>

      <h2>The ledger is still a ledger</h2>
      <p>
        None of the above bends the accounting. Debits equal credits, enforced in the database.
        The chart of accounts is yours to change. The trial balance ties. An auditor who has never
        heard of this product can be handed a journal export and will recognise everything in it.
        Local does not mean improvised.
      </p>
    </ProsePage>
  );
}
