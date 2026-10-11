import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

interface Draft {
  text: string;
  subject: string;
  email: string | null;
}

/**
 * A payment reminder drafted by Cloudflare Workers AI from the invoice, for
 * the person to edit and send themselves. Nothing is sent from here.
 */
export function ReminderDraftDialog({ invoiceId, invoiceNumber, onClose }: { invoiceId: string; invoiceNumber: string; onClose: () => void }) {
  const [language, setLanguage] = useState<'en' | 'sw'>('en');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const draft = useMutation({
    mutationFn: (lang: 'en' | 'sw') => apiRequest<Draft>('/api/ai/invoice-reminder', { body: { invoiceId, language: lang }, fallback: 'No reminder came back. Try again.' }),
    onSuccess: (result) => { setText(result.text); setCopied(false); },
  });

  useEffect(() => { draft.mutate('en'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [invoiceId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const mailto = draft.data?.email
    ? `mailto:${encodeURIComponent(draft.data.email)}?subject=${encodeURIComponent(draft.data.subject)}&body=${encodeURIComponent(text)}`
    : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reminder for ${invoiceNumber}`}
      note="Drafted by Cloudflare Workers AI from the invoice and your payment details. Read it and change anything before you send it; nothing is sent from here."
      footer={
        <>
          {copied && <span role="status" className="mr-auto text-[13px] text-ink-900">Copied.</span>}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Close</button>
          {mailto && <a href={mailto} className={buttonClass.secondary}>Open in email</a>}
          <button type="button" onClick={copy} disabled={!text || draft.isPending} className={buttonClass.primary}>Copy the reminder</button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Language">
            <select value={language} onChange={(e) => { const next = e.target.value as 'en' | 'sw'; setLanguage(next); draft.mutate(next); }} disabled={draft.isPending}>
              <option value="en">English</option>
              <option value="sw">Kiswahili</option>
            </select>
          </Field>
          <button type="button" onClick={() => draft.mutate(language)} disabled={draft.isPending} className={buttonClass.quiet}>
            Draft again
          </button>
        </div>
        {draft.isError && <p role="alert" className="text-[13px] text-ledger-red">{(draft.error as Error).message}</p>}
        {draft.isPending && !text ? (
          <p role="status" className="text-[13.5px] text-graphite-600">Drafting the reminder</p>
        ) : (
          <Field label="Reminder" hint={language === 'sw' ? 'Machine-drafted Kiswahili: read it through before sending.' : undefined}>
            <textarea rows={9} value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} aria-busy={draft.isPending} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
