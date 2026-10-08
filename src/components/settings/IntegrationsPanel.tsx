import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { EmptyNote, buttonClass } from '../ledger/Page';
import { Field } from '../ledger/Dialog';

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
}

const copy = {
  heading: { en: 'M-Pesa giving', sw: 'TODO-SW' },
  save: { en: 'Save M-Pesa settings', sw: 'TODO-SW' },
  register: { en: 'Register URLs with Safaricom', sw: 'TODO-SW' },
  empty: { en: 'No M-Pesa settings yet. Enter the church\'s paybill and Daraja keys to start.', sw: 'TODO-SW' },
};

const when = (value: string) => new Intl.DateTimeFormat('en-KE', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
}).format(new Date(value));

/**
 * Settings, Integrations: the church's Daraja C2B link. Owners and admins
 * only. The consumer key and secret are sent once, kept in Supabase Vault
 * and never shown again; Safaricom is called from the server.
 */
export function IntegrationsPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['mpesa-integration', orgId],
    queryFn: () => apiRequest<MpesaSettings>('/api/integrations/mpesa', { fallback: 'The M-Pesa settings could not be loaded.' }),
  });
  const team = useQuery({
    queryKey: ['team', orgId],
    queryFn: () => apiRequest<{ members: Array<{ userId: string; email: string; role: string }> }>('/api/team', { fallback: 'The team could not be loaded.' }),
  });
  const [shortcode, setShortcode] = useState('');
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>('SANDBOX');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [actor, setActor] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [urls, setUrls] = useState<{ confirmationUrl: string; validationUrl: string } | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setShortcode(settings.data.shortcode || '');
    setEnvironment(settings.data.environment);
    setActor(settings.data.integrationActorId || '');
  }, [settings.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mpesa-integration', orgId] });
  const save = useMutation({
    mutationFn: () => apiRequest<MpesaSettings>('/api/integrations/mpesa', {
      method: 'PUT',
      body: { shortcode, environment, consumerKey, consumerSecret, integrationActorId: actor || null },
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
      <h2 id="mpesa-heading" className="ll-heading text-[22px] text-ink-900">{copy.heading.en}</h2>
      <p className="mt-2 text-[13.5px] text-graphite-600">
        When someone pays the church&apos;s paybill, Safaricom sends the payment here. Ledger Link keeps the receipt and posts it
        to the member and fund its account reference names. A receipt the giving rules cannot place waits in Giving, Queue.
        Matching reads the account reference only: Safaricom masks the payer&apos;s phone number.
      </p>
      <p className="mt-2 text-[13px] text-ink-900"><span className="font-semibold">Status:</span> {status}</p>
      {current.lastError && <p className="mt-1 text-[13px] text-ledger-red">Last attempt: {current.lastError}</p>}
    </div>
    {!current.configured && <EmptyNote>{copy.empty.en}</EmptyNote>}

    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <Field label="Paybill or till number" hint="The shortcode Safaricom gave the church.">
        <input value={shortcode} onChange={(e) => setShortcode(e.target.value)} inputMode="numeric" required />
      </Field>
      <Field label="Daraja environment" hint="Try a sandbox payment before switching to production.">
        <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'SANDBOX' | 'PRODUCTION')}>
          <option value="SANDBOX">Sandbox (test)</option>
          <option value="PRODUCTION">Production (live payments)</option>
        </select>
      </Field>
      <Field label="Consumer key" hint={current.hasCredentials ? 'Saved. Leave blank to keep it.' : 'From the church\'s app on the Daraja portal.'}>
        <input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} autoComplete="off" type="password" />
      </Field>
      <Field label="Consumer secret" hint="Kept in Supabase Vault and never shown again.">
        <input value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} autoComplete="off" type="password" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Post M-Pesa giving in the name of" hint="An owner, admin or accountant. With no one named, every receipt waits in the queue.">
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">No one: every receipt waits in the queue</option>
            {posters.map((member) => <option key={member.userId} value={member.userId}>{member.email} ({member.role})</option>)}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>{copy.save.en}</button>
        <button type="button" className={buttonClass.secondary} disabled={!current.hasCredentials || register.isPending}
          onClick={() => register.mutate()}>
          {register.isPending ? 'Asking Safaricom' : copy.register.en}
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
      Churches without Daraja access can upload the M-Pesa statement in Giving instead.
    </p>
  </section>;
}
