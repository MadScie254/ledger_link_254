import { useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Paperclip } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

export type AttachmentRecordType =
  | 'INVOICE' | 'BILL' | 'CASH_TRANSACTION' | 'CREDIT_NOTE' | 'PURCHASE_ORDER' | 'ESTIMATE' | 'SALES_ORDER'
  | 'JOURNAL_ENTRY' | 'CUSTOMER' | 'VENDOR' | 'BANK_TRANSACTION';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.csv,.docx,.txt,application/pdf,image/*';

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** Uploads one file to a record; used by the panel and after posting a scanned receipt. */
export async function attachFile(recordType: AttachmentRecordType, recordId: string, file: File) {
  const form = new FormData();
  form.set('recordType', recordType);
  form.set('recordId', recordId);
  form.set('file', file);
  const response = await fetch('/api/attachments', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The file could not be attached.');
  return data.attachment;
}

/**
 * The files on one record: receipts, the supplier's PDF, a signed delivery
 * note. Each can be downloaded; those who post can attach and remove them.
 */
export function AttachmentsPanel({ recordType, recordId, label = 'Files' }: { recordType: AttachmentRecordType; recordId: string; label?: string }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const canPost = activeCompany?.role !== 'member';
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const key = ['attachments', currentOrgId, recordType, recordId];

  const list = useQuery({
    queryKey: key,
    queryFn: () => apiRequest<{ attachments: any[] }>(`/api/attachments?recordType=${recordType}&recordId=${recordId}`, { fallback: 'The files could not be listed.' }),
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await attachFile(recordType, recordId, file);
    },
    onSuccess: () => { setProblem(''); queryClient.invalidateQueries({ queryKey: key }); },
    onError: (err: Error) => { setProblem(err.message); queryClient.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/attachments/${id}`, { method: 'DELETE', fallback: 'The file could not be removed.' }),
    onSuccess: () => { setProblem(''); queryClient.invalidateQueries({ queryKey: key }); },
    onError: (err: Error) => setProblem(err.message),
  });

  const download = async (attachment: any) => {
    setProblem('');
    const response = await fetch(`/api/attachments/${attachment.id}/download`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setProblem(data.error || 'The file could not be downloaded.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const attachments = list.data?.attachments || [];

  return (
    <section aria-label={label} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink-900">{label}</h3>
        {canPost && (
          <>
            <input
              ref={input}
              type="file"
              name="attachment"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-label={`Attach files to this ${recordType.toLowerCase().replace('_', ' ')}`}
              onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) upload.mutate(files); }}
            />
            <button type="button" className={buttonClass.quiet} disabled={upload.isPending} onClick={() => input.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> {upload.isPending ? 'Attaching' : 'Attach a file'}
            </button>
          </>
        )}
      </div>
      {problem && <p role="alert" className="text-[12.5px] text-ledger-red">{problem}</p>}
      {list.isLoading ? (
        <p className="text-[12.5px] text-graphite-600">Loading files</p>
      ) : attachments.length === 0 ? (
        <p className="text-[12.5px] text-graphite-600">No files attached. PDFs, photos, spreadsheets and Word documents of up to 5 MB can be attached.</p>
      ) : (
        <ul className="border-t border-feint text-[13px]">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-feint py-1.5">
              <button type="button" onClick={() => download(a)} className="min-w-0 truncate text-left text-ink-900 underline decoration-feint-strong underline-offset-2 hover:decoration-ink-900">
                {a.fileName}
              </button>
              <span className="text-[12px] text-graphite-600">
                {sizeText(a.sizeBytes)} · {format(parseISO(a.createdAt), 'dd/MM/yyyy')}
                {canPost && (
                  <button type="button" className={`${buttonClass.quiet} ml-2`} disabled={remove.isPending} onClick={() => remove.mutate(a.id)} aria-label={`Remove ${a.fileName}`}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A quiet "Files" button that opens a record's files in a dialog. */
export function AttachmentsButton({ recordType, recordId, title }: { recordType: AttachmentRecordType; recordId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass.quiet} onClick={() => setOpen(true)}>
        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> Files
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Files on ${title}`} footer={<button type="button" onClick={() => setOpen(false)} className={buttonClass.secondary}>Close</button>}>
        {open && <AttachmentsPanel recordType={recordType} recordId={recordId} />}
      </Dialog>
    </>
  );
}
