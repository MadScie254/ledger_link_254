import { ProsePage } from './ProsePage';

export function ForAccountantsPage() {
  return (
    <ProsePage
      title="If you are the accountant, not the owner"
      standfirst="You are the one who will live in this, month after month, closing books you did not open. This page is about whether the software will fight you."
    >
      <h2>Every number drills to its journal entry</h2>
      <p>
        A figure on the profit and loss opens the accounts behind it, which open the journal lines
        behind those, which open the entry, which carries the source document and the user who
        posted it. Nothing is a dead end, and nothing is computed in a way you cannot retrace.
      </p>

      <h2>The ledger is enforced below the application</h2>
      <p>
        Journal entries are posted through a Postgres function that rejects an unbalanced entry, a
        line carrying both a debit and a credit, and a caller who is not a member of the
        organization. This matters to you specifically: it means no future bug in a screen you do
        not use can put the books you are responsible for out of balance.
      </p>

      <h2>Density over whitespace</h2>
      <p>
        Tables show ten transactions per screen rather than four. Numbers are set in a monospaced
        face with tabular figures and aligned right, so a column of shillings reads as a column
        rather than as ragged text. Nothing is padded to look calm.
      </p>

      <h2>You cannot be locked out of your own client&rsquo;s books</h2>
      <p>
        Access is per-organization with a real audit log behind it. An owner can invite you as an
        admin, and every action you take is attributed and timestamped. If the relationship ends,
        the client revokes your membership and keeps the full history of what you did, which
        protects both of you.
      </p>

      <h2>Navigation without the mouse</h2>
      <p>
        Ctrl+K opens a command palette that searches screens, records and reports, and takes arrow
        keys and Enter. The number keys 1 to 6 jump straight to the dashboard, sales, expenses,
        banking, accounting and reports.
      </p>

      <h2>What is not built yet</h2>
      <p>
        Vim-style leader sequences, row-level keyboard navigation in tables and the printable
        keyboard reference are specified and scheduled, but they are not in the product today, and
        this page will not pretend otherwise. The same goes for ledger book view, the setting that
        renders the whole application as a two-column serif ledger with no interface chrome. When
        they ship, they will be described here in the present tense and not before.
      </p>
    </ProsePage>
  );
}
