import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { EmptyNote, buttonClass } from '../ledger/Page';
import { Field } from '../ledger/Dialog';
import { Amount } from '../ledger/Amount';
import { localized, text } from '../../utils/language';

interface MpesaSettings {
  configured: boolean;
  shortcode: string | null;
  environment: 'SANDBOX' | 'PRODUCTION';
  status: 'DRAFT' | 'REGISTERED' | 'DISABLED';
  registeredAt: string | null;
  lastError: string | null;
  hasCredentials: boolean;
  hasCallbackUrls: boolean;
  integrationActorId: string | null;
  /** A business's M-Pesa money account. */
  moneyAccountId?: string | null;
  /** Whether a business saved its M-Pesa Express passkey. */
  hasExpressPasskey?: boolean;
}

interface MpesaPayment {
  id: string;
  transId: string;
  transTime: string;
  amountCents: number;
  accountNumber: string | null;
  payerName: string | null;
  outcome: 'WAITING' | 'SETTLED';
  note: string | null;
  invoiceNumber: string | null;
}

type Edition = 'business' | 'church';

const copy = {
  heading: { church: localized('M-Pesa giving'), business: localized('M-Pesa payments') },
  save: localized('Save M-Pesa settings'),
  register: localized('Register URLs with Safaricom'),
  empty: {
    church: localized('No M-Pesa settings yet. Enter the church\'s paybill and Daraja keys to start.'),
    business: localized('No M-Pesa settings yet. Enter the business\'s paybill or till and Daraja keys to start.'),
  },
};

const when = (value: string) => new Intl.DateTimeFormat('en-KE', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
}).format(new Date(value));

/**
 * Settings, Integrations: the organization's Daraja C2B link. Owners and
 * admins only. The consumer key and secret are sent once, kept in Supabase
 * Vault and never shown again; Safaricom is called from the server. A
 * church's payments are gifts placed by its giving rules; a business's land
 * on its M-Pesa account and settle the invoice their account number names.
 */
export function IntegrationsPanel({ orgId, edition, baseCurrency }: { orgId: string; edition: Edition; baseCurrency: string }) {
  const isBusiness = edition === 'business';
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['mpesa-integration', orgId],
    queryFn: () => apiRequest<MpesaSettings>('/api/integrations/mpesa', { fallback: 'The M-Pesa settings could not be loaded.' }),
  });
  const team = useQuery({
    queryKey: ['team', orgId],
    queryFn: () => apiRequest<{ members: Array<{ userId: string; email: string; role: string }> }>('/api/team', { fallback: 'The team could not be loaded.' }),
  });
  const accounts = useQuery({
    queryKey: ['accounts', orgId],
    queryFn: () => apiRequest<{ accounts: Array<{ id: string; code: string; name: string; currency: string; isBankAccount: boolean; isActive: boolean }> }>('/api/accounts'),
    enabled: isBusiness,
  });
  const [shortcode, setShortcode] = useState('');
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>('SANDBOX');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [actor, setActor] = useState('');
  const [moneyAccountId, setMoneyAccountId] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [urls, setUrls] = useState<{ confirmationUrl: string; validationUrl: string } | null>(null);

  const moneyAccounts = (accounts.data?.accounts || [])
    .filter((account) => account.isBankAccount && account.isActive && account.currency.toUpperCase() === baseCurrency.toUpperCase());

  useEffect(() => {
    if (!settings.data) return;
    setShortcode(settings.data.shortcode || '');
    setEnvironment(settings.data.environment);
    setActor(settings.data.integrationActorId || '');
    setMoneyAccountId(settings.data.moneyAccountId || '');
  }, [settings.data]);

  // Before anything is saved, a business's payments go to account 1050 if it has one.
  useEffect(() => {
    if (!isBusiness || moneyAccountId || settings.data?.moneyAccountId) return;
    const mpesa = moneyAccounts.find((account) => account.code === '1050');
    if (mpesa) setMoneyAccountId(mpesa.id);
  }, [isBusiness, moneyAccountId, settings.data?.moneyAccountId, moneyAccounts]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mpesa-integration', orgId] });
  const save = useMutation({
    mutationFn: () => apiRequest<MpesaSettings>('/api/integrations/mpesa', {
      method: 'PUT',
      body: {
        shortcode, environment, consumerKey, consumerSecret, integrationActorId: actor || null,
        ...(isBusiness ? { moneyAccountId: moneyAccountId || null } : {}),
      },
      fallback: 'The M-Pesa settings were not saved.',
    }),
    onSuccess: () => {
      setConsumerKey(''); setConsumerSecret(''); setProblem('');
      setNotice(consumerKey ? 'M-Pesa settings saved. The consumer key and secret are in Vault.' : 'M-Pesa settings saved.');
      refresh();
    },
    onError: (err: Error) => { setNotice(''); setProblem(err.message); },
  });
  const register = useMutation({
    mutationFn: () => apiRequest<{ registered: boolean; message: string }>('/api/integrations/mpesa/register', {
      method: 'POST', body: {}, fallback: 'The URLs were not registered.',
    }),
    onSuccess: (result) => {
      if (result.registered) { setProblem(''); setNotice(`Safaricom registered the URLs: ${result.message}`); }
      else { setNotice(''); setProblem(result.message); }
      refresh();
    },
    onError: (err: Error) => { setNotice(''); setProblem(err.message); },
  });
  const issue = useMutation({
    mutationFn: () => apiRequest<{ confirmationUrl: string; validationUrl: string }>('/api/integrations/mpesa/callback-urls', {
      method: 'POST', body: {}, fallback: 'New URLs were not made.',
    }),
    onSuccess: (result) => { setUrls(result); setProblem(''); setNotice('New URLs made. The old ones no longer work.'); refresh(); },
    onError: (err: Error) => { setNotice(''); setProblem(err.message); },
  });

  if (settings.isLoading) return <p role="status" className="text-[13px] text-graphite-600">Opening the M-Pesa settings</p>;
  if (settings.isError) return <EmptyNote>{(settings.error as Error).message}</EmptyNote>;
  const current = settings.data!;
  const posters = (team.data?.members || []).filter((member) => ['owner', 'admin', 'accountant'].includes(member.role));
  const status = !current.configured ? 'Not saved'
    : current.status === 'REGISTERED' && current.registeredAt ? `URLs registered with Safaricom on ${when(current.registeredAt)}`
      : current.hasCallbackUrls ? 'URLs made for registering by hand'
        : 'Saved. URLs not registered yet';

  return <section aria-labelledby="mpesa-heading" className="max-w-3xl space-y-5">
    <div className="border-t-2 border-ink-900 pt-5">
      <h2 id="mpesa-heading" className="ll-heading text-[22px] text-ink-900">{text(copy.heading[edition])}</h2>
      {isBusiness ? <p className="mt-2 text-[13.5px] text-graphite-600">
        When a customer pays the business&apos;s paybill or till, Safaricom sends the payment here. Ledger Link adds it once to the
        M-Pesa account&apos;s statement lines; the same receipt in a statement uploaded later is skipped. When the account number
        the customer typed is an open invoice&apos;s number (INV-2026-00042, or INV202600042), the payment settles that invoice.
        Any other payment, and any till payment, waits in Banking for a person to match. Matching reads the account number only:
        Safaricom masks the payer&apos;s phone number.
      </p> : <p className="mt-2 text-[13.5px] text-graphite-600">
        When someone pays the church&apos;s paybill, Safaricom sends the payment here. Ledger Link keeps the receipt and posts it
        to the member and fund its account reference names. A receipt the giving rules cannot place waits in Giving, Queue.
        Matching reads the account reference only: Safaricom masks the payer&apos;s phone number.
      </p>}
      <p className="mt-2 text-[13px] text-ink-900"><span className="font-semibold">Status:</span> {status}</p>
      {current.lastError && <p className="mt-1 text-[13px] text-ledger-red">Last attempt: {current.lastError}</p>}
    </div>
    {!current.configured && <EmptyNote>{text(copy.empty[edition])}</EmptyNote>}

    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <Field label="Paybill or till number" hint={`The shortcode Safaricom gave the ${isBusiness ? 'business' : 'church'}.`}>
        <input value={shortcode} onChange={(e) => setShortcode(e.target.value)} inputMode="numeric" required />
      </Field>
      <Field label="Daraja environment" hint="Try a sandbox payment before switching to production.">
        <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'SANDBOX' | 'PRODUCTION')}>
          <option value="SANDBOX">Sandbox (test)</option>
          <option value="PRODUCTION">Production (live payments)</option>
        </select>
      </Field>
      <Field label="Consumer key" hint={current.hasCredentials ? 'Saved. Leave blank to keep it.' : `From the ${isBusiness ? 'business' : 'church'}'s app on the Daraja portal.`}>
        <input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} autoComplete="off" type="password" />
      </Field>
      <Field label="Consumer secret" hint="Kept in Supabase Vault and never shown again.">
        <input value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} autoComplete="off" type="password" />
      </Field>
      {isBusiness && <div className="sm:col-span-2">
        <Field label="Payments land in" hint={`A bank, cash or M-Pesa account in ${baseCurrency}. Import this account's M-Pesa statements here too.`}>
          <select value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)} required>
            <option value="">Choose an account</option>
            {moneyAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select>
        </Field>
      </div>}
      <div className="sm:col-span-2">
        <Field
          label={isBusiness ? 'Settle invoices in the name of' : 'Post M-Pesa giving in the name of'}
          hint={isBusiness
            ? 'An owner, admin or accountant. With no one named, every payment waits in Banking.'
            : 'An owner, admin or accountant. With no one named, every receipt waits in the queue.'}
        >
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">{isBusiness ? 'No one: every payment waits in Banking' : 'No one: every receipt waits in the queue'}</option>
            {posters.map((member) => <option key={member.userId} value={member.userId}>{member.email} ({member.role})</option>)}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>{text(copy.save)}</button>
        <button type="button" className={buttonClass.secondary} disabled={!current.hasCredentials || register.isPending}
          onClick={() => register.mutate()}>
          {register.isPending ? 'Asking Safaricom' : text(copy.register)}
        </button>
        <button type="button" className={buttonClass.quiet} disabled={!current.configured || issue.isPending}
          onClick={() => {
            if (window.confirm('Make new URLs? The URLs Safaricom has now stop working until you register the new ones.')) issue.mutate();
          }}>
          Make URLs to register by hand
        </button>
      </div>
    </form>
    <div aria-live="polite">
      {notice && <p className="text-[13px] text-ink-900">{notice}</p>}
      {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
    </div>
    {urls && <div className="border border-feint-strong p-4 text-[13px]">
      <p className="font-semibold text-ink-900">Give these to Safaricom. They are shown once.</p>
      <dl className="mt-2 space-y-2 break-all">
        <div><dt className="ll-printed text-[11px] text-graphite-600">Confirmation URL</dt><dd className="font-mono text-[12px]">{urls.confirmationUrl}</dd></div>
        <div><dt className="ll-printed text-[11px] text-graphite-600">Validation URL</dt><dd className="font-mono text-[12px]">{urls.validationUrl}</dd></div>
      </dl>
    </div>}
    <p className="text-[12.5px] text-graphite-600">
      In production Safaricom registers a paybill&apos;s URLs once; changing them later goes through Safaricom.
      {isBusiness
        ? ' A business without Daraja access can import its M-Pesa statement in Banking, Import statement.'
        : ' Churches without Daraja access can upload the M-Pesa statement in Giving instead.'}
    </p>
    {isBusiness && current.configured && <ExpressPasskey orgId={orgId} saved={Boolean(current.hasExpressPasskey)} />}
    {isBusiness && current.configured && <RecentPayments orgId={orgId} currency={baseCurrency} />}
  </section>;
}

/**
 * The M-Pesa Express passkey Safaricom issues for a paybill. With it, an
 * open invoice can ask the customer's phone to pay (Sales, Invoices, Ask by
 * M-Pesa). It is kept in Vault and never shown again.
 */
function ExpressPasskey({ orgId, saved }: { orgId: string; saved: boolean }) {
  const queryClient = useQueryClient();
  const [passkey, setPasskey] = useState('');
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: (value: string) => apiRequest('/api/integrations/mpesa/express', {
      method: 'PUT', body: { passkey: value }, fallback: 'The passkey was not saved.',
    }),
    onSuccess: (_result, value) => {
      setPasskey(''); setProblem('');
      setMessage(value ? 'Passkey saved in Vault. Open invoices can ask for payment by M-Pesa.' : 'Passkey removed. Invoices no longer ask for payment.');
      queryClient.invalidateQueries({ queryKey: ['mpesa-integration', orgId] });
      queryClient.invalidateQueries({ queryKey: ['mpesa-express-status', orgId] });
    },
    onError: (err: Error) => { setMessage(''); setProblem(err.message); },
  });
  return <div className="space-y-3 border-t border-feint-strong pt-4">
    <h3 className="text-sm font-semibold text-text">Ask for payment from an invoice</h3>
    <p className="text-[13px] text-graphite-600">
      With the M-Pesa Express passkey Safaricom issues for the paybill, an open invoice can send a payment request to the
      customer&apos;s phone, showing the paybill with the invoice&apos;s number as the account. Paybills only: a till has no account number.
      {saved ? ' A passkey is saved.' : ' No passkey is saved, so invoices cannot ask for payment.'}
    </p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(passkey.trim()); }}>
      <Field label="M-Pesa Express passkey" hint={saved ? 'Saved. Enter a new one to replace it.' : 'From the Daraja portal, for this paybill.'}>
        <input value={passkey} onChange={(e) => setPasskey(e.target.value)} autoComplete="off" type="password" />
      </Field>
      <button type="submit" className={buttonClass.secondary} disabled={save.isPending || !passkey.trim()}>Save passkey</button>
      {saved && <button type="button" className={buttonClass.quiet} disabled={save.isPending}
        onClick={() => { if (window.confirm('Remove the passkey? Invoices stop asking for payment by M-Pesa.')) save.mutate(''); }}>
        Remove passkey
      </button>}
    </form>
    <div aria-live="polite">
      {message && <p className="text-[13px] text-ink-900">{message}</p>}
      {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
    </div>
  </div>;
}

/** What Safaricom sent, newest first, with the invoice each settled or why it waits. */
function RecentPayments({ orgId, currency }: { orgId: string; currency: string }) {
  const queryClient = useQueryClient();
  const payments = useQuery({
    queryKey: ['mpesa-payments', orgId],
    queryFn: () => apiRequest<{ payments: MpesaPayment[] }>('/api/integrations/mpesa/payments', { fallback: 'The M-Pesa payments could not be loaded.' }),
  });
  const [message, setMessage] = useState('');
  const settle = useMutation({
    mutationFn: (id: string) => apiRequest<{ outcome: 'SETTLED' | 'WAITING'; invoiceNumber?: string; journalEntryId?: string; note?: string }>(
      `/api/integrations/mpesa/payments/${id}/settle`, { method: 'POST', body: {}, fallback: 'The payment was not settled.' }),
    onSuccess: (result) => {
      setMessage(result.outcome === 'SETTLED'
        ? `${result.invoiceNumber} settled. Journal entry ${result.journalEntryId}.`
        : result.note || 'The payment still waits in Banking.');
      queryClient.invalidateQueries({ queryKey: ['mpesa-payments', orgId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', orgId] });
      queryClient.invalidateQueries({ queryKey: ['bank_transactions', orgId] });
      queryClient.invalidateQueries({ queryKey: ['banking-transactions', orgId] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return <div className="space-y-2 border-t border-feint-strong pt-4">
    <h3 className="text-sm font-semibold text-text">Payments received</h3>
    {payments.isLoading && <p role="status" className="text-[13px] text-graphite-600">Loading payments</p>}
    {payments.isError && <p className="text-[13px] text-ledger-red">{(payments.error as Error).message}</p>}
    {payments.data && payments.data.payments.length === 0 && (
      <p className="text-[13px] text-graphite-600">No M-Pesa payments have arrived yet. The first one appears here and in Banking.</p>
    )}
    {payments.data && payments.data.payments.length > 0 && <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-[13px]">
        <caption className="sr-only">M-Pesa payments received</caption>
        <thead>
          <tr className="border-b border-feint-strong text-left text-graphite-600">
            <th scope="col" className="py-1.5 pr-3 font-normal">Received</th>
            <th scope="col" className="py-1.5 pr-3 font-normal">Receipt</th>
            <th scope="col" className="py-1.5 pr-3 font-normal">From and account number</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Amount</th>
            <th scope="col" className="py-1.5 font-normal">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {payments.data.payments.map((payment) => <tr key={payment.id} className="border-b border-feint align-top">
            <td className="py-1.5 pr-3 whitespace-nowrap">{when(payment.transTime)}</td>
            <td className="py-1.5 pr-3 font-mono text-[12px]">{payment.transId}</td>
            <td className="py-1.5 pr-3">{payment.payerName || 'Name not sent'}{payment.accountNumber ? ` · ${payment.accountNumber}` : ''}</td>
            <td className="py-1.5 pr-3 text-right"><Amount cents={payment.amountCents} currency={currency} tone="ink" /></td>
            <td className="py-1.5">
              {payment.outcome === 'SETTLED'
                ? <span className="text-ink-900">Settled {payment.invoiceNumber}</span>
                : <span className="text-graphite-600">
                    {payment.note || 'Waits in Banking.'}{' '}
                    <button type="button" className={buttonClass.quiet} disabled={settle.isPending}
                      onClick={() => { setMessage(''); settle.mutate(payment.id); }}>
                      Settle from the account number
                    </button>
                  </span>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    <div aria-live="polite">{message && <p className="text-[13px] text-ink-900">{message}</p>}</div>
  </div>;
}
