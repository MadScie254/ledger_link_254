import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthProvider';
import { apiRequest } from '../../utils/apiRequest';
import { Amount } from '../ledger/Amount';
import { EmptyNote, IndexTabs, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import {
  AssignReceiptDialog, BankCountDialog, ConfirmCountDialog, GiftDialog, SetAsideDialog, StartCountDialog, StatementUploadDialog,
  type QueueItem,
} from './ChurchDialogs';
import { COUNT_STATUS, GIFT_METHODS, refreshChurch, say, shortDate, useChurchOrg } from './churchData';

type Tab = 'today' | 'queue' | 'cash';

const COPY = {
  giving: say('Giving'),
  recordGift: say('Record a gift'),
  upload: say('Upload M-Pesa statement'),
  startCount: say('Start a cash count'),
  noGifts: say('No giving recorded on this day.'),
  queueEmpty: say('The queue is empty. Every M-Pesa receipt has been placed.'),
  noCounts: say('No cash counts yet. Start one after the service.'),
};

const timeOf = (iso: string) => new Intl.DateTimeFormat('en-KE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
}).format(new Date(iso));

function Notice({ message }: { message: string }) {
  return message ? <p role="status" className="text-[13.5px] text-ink-900">{message}</p> : null;
}

export function GivingView({ initialTab = 'today' }: { initialTab?: Tab }) {
  const { canPost } = useChurchOrg();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dialog, setDialog] = useState<'gift' | 'statement' | 'count' | null>(null);
  const [notice, setNotice] = useState('');
  const done = (message: string) => { setDialog(null); setNotice(message); };
  return (
    <div className="space-y-5">
      <PageHeading title={tab === 'cash' ? 'Cash count' : COPY.giving.en}
        note={tab === 'cash' ? 'Each service\'s cash, counted by two people, then banked.' : 'Gifts by M-Pesa, cash, bank and cheque, each posted to its fund.'}
        actions={canPost && (
          <>
            {tab === 'queue' && <button type="button" className={buttonClass.secondary} onClick={() => setDialog('statement')}>{COPY.upload.en}</button>}
            {tab === 'cash'
              ? <button type="button" className={buttonClass.primary} onClick={() => setDialog('count')}>{COPY.startCount.en}</button>
              : <button type="button" className={buttonClass.primary} onClick={() => setDialog('gift')}>{COPY.recordGift.en}</button>}
          </>
        )} />
      <IndexTabs label="Giving" active={tab} onChange={(id) => { setTab(id); setNotice(''); }}
        tabs={[{ id: 'today', name: 'Today' }, { id: 'queue', name: 'Queue' }, { id: 'cash', name: 'Cash count' }]} />
      <Notice message={notice} />
      {tab === 'today' && <TodayTab />}
      {tab === 'queue' && <QueueTab onDone={setNotice} />}
      {tab === 'cash' && <CashTab onDone={setNotice} />}
      {dialog === 'gift' && <GiftDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'statement' && <StatementUploadDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'count' && <StartCountDialog onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

/** The Cash count page in the sidebar: Giving opened at its cash count tab. */
export function CashCountView() {
  return <GivingView initialTab="cash" />;
}

function TodayTab() {
  const { orgId, today, currency } = useChurchOrg();
  const [date, setDate] = useState(today);
  const day = useQuery({
    queryKey: ['giving-day', orgId, date],
    queryFn: () => apiRequest<{ totalCents: number; byFund: any[]; byMethod: Record<string, number>; gifts: any[] }>(`/api/giving/day?date=${date}`, { fallback: 'The day\'s giving could not be loaded.' }),
  });
  return (
    <div className="space-y-4">
      <label className="text-[13px]">
        <span className="block font-semibold text-ink-900">Day</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} className="mt-1 h-9 border px-2 text-[14px]" name="date" />
      </label>
      {day.isError ? <LoadProblem what="the day's giving" path="/api/giving/day" onRetry={() => day.refetch()} />
        : day.isLoading || !day.data ? <SkeletonRows label="Loading the day's giving" rows={4} />
          : day.data.gifts.length === 0 ? <EmptyNote>{COPY.noGifts.en}</EmptyNote> : (
            <>
              <dl className="grid grid-cols-2 border-b border-feint-strong sm:grid-cols-5">
                <div className="py-3"><dt className="ll-printed text-[10.5px] text-graphite-600">Total</dt><dd className="mt-1"><Amount cents={day.data.totalCents} currency={currency} size="lg" /></dd></div>
                {['MPESA', 'CASH', 'BANK', 'CHEQUE'].map((method) => (
                  <div key={method} className="border-l border-feint py-3 pl-4">
                    <dt className="ll-printed text-[10.5px] text-graphite-600">{GIFT_METHODS[method].en}</dt>
                    <dd className="mt-1"><Amount cents={day.data!.byMethod[method] || 0} currency={currency} /></dd>
                  </div>
                ))}
              </dl>
              <section aria-labelledby="day-funds">
                <h2 id="day-funds" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">By fund</h2>
                <ul>
                  {day.data.byFund.map((fund) => (
                    <li key={fund.fundId} className="flex justify-between border-b border-feint py-2 text-[13.5px]"><span>{fund.name}</span><Amount cents={fund.cents} currency={currency} /></li>
                  ))}
                </ul>
              </section>
              <table className="w-full text-[13.5px]">
                <caption className="ll-heading border-b border-feint-strong pb-1 text-left text-[17px] text-ink-900">Gifts</caption>
                <thead><tr><th scope="col" className="text-left">Member</th><th scope="col" className="text-left">Fund</th><th scope="col" className="text-left">How</th><th scope="col" className="text-right">Amount</th></tr></thead>
                <tbody>
                  {day.data.gifts.map((gift) => (
                    <tr key={gift.id}>
                      <td className="py-1.5">{gift.members ? `${gift.members.member_number} · ${[gift.members.first_name, gift.members.last_name].filter(Boolean).join(' ')}` : gift.collection_id ? 'Service collection' : 'No member named'}</td>
                      <td className="py-1.5">{gift.funds?.name}</td>
                      <td className="py-1.5">{GIFT_METHODS[gift.method]?.en}{gift.reference ? ` · ${gift.reference}` : ''}</td>
                      <td className="py-1.5 text-right"><Amount cents={Number(gift.amount_cents)} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
    </div>
  );
}

function QueueTab({ onDone }: { onDone: (message: string) => void }) {
  const { orgId, currency, canPost } = useChurchOrg();
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState<QueueItem | null>(null);
  const [settingAside, setSettingAside] = useState<QueueItem | null>(null);
  const queue = useQuery({
    queryKey: ['giving-queue', orgId],
    queryFn: () => apiRequest<{ waiting: QueueItem[]; setAside: any[] }>('/api/giving/queue', { fallback: 'The queue could not be loaded.' }),
  });
  const restore = useMutation({
    mutationFn: (item: any) => apiRequest(`/api/giving/queue/${item.id}/restore`, { method: 'POST', body: {} }),
    onSuccess: (_result, item) => { refreshChurch(queryClient, orgId); onDone(`M-Pesa receipt ${item.transId} is back in the queue.`); },
  });
  const done = (message: string) => { setAssigning(null); setSettingAside(null); onDone(message); };
  if (queue.isError) return <LoadProblem what="the queue" path="/api/giving/queue" onRetry={() => queue.refetch()} />;
  if (queue.isLoading || !queue.data) return <SkeletonRows label="Loading the queue" />;
  const { waiting, setAside } = queue.data;
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-[13px] text-graphite-600">M-Pesa receipts the giving rules could not place. Place each with its member and fund, or set it aside if it is not giving.</p>
      {waiting.length === 0 ? <EmptyNote>{COPY.queueEmpty.en}</EmptyNote> : (
        <table className="w-full text-[13.5px]">
          <caption className="sr-only">M-Pesa receipts waiting</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 text-left">Receipt</th>
              <th scope="col" className="pr-3 text-left">Reference and payer</th>
              <th scope="col" className="hidden pr-3 text-left md:table-cell">Why it waits</th>
              <th scope="col" className="pr-3 text-right">Amount</th>
              <th scope="col" className="text-left"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="py-2 pr-3"><span className="ll-figure">{item.transId}</span><span className="block text-[12px] text-graphite-600">{timeOf(item.transTime)}</span></td>
                <td className="py-2 pr-3">{item.billRefNumber ? `"${item.billRefNumber}"` : 'No reference'}<span className="block text-[12px] text-graphite-600">{item.firstName || ''}</span>
                  {item.suggestions[0] && <span className="block text-[12px] text-graphite-600">Perhaps {item.suggestions[0].memberNumber} · {item.suggestions[0].name}</span>}</td>
                <td className="hidden py-2 pr-3 text-graphite-600 md:table-cell">{item.reason}</td>
                <td className="py-2 pr-3 text-right"><Amount cents={item.amountCents} currency={currency} /></td>
                <td className="py-2">
                  {canPost && (
                    <span className="flex flex-col items-start gap-1">
                      <button type="button" className={buttonClass.quiet} onClick={() => setAssigning(item)}>Place</button>
                      <button type="button" className={buttonClass.quiet} onClick={() => setSettingAside(item)}>Set aside</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {setAside.length > 0 && (
        <section aria-labelledby="set-aside">
          <h2 id="set-aside" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Set aside, not giving</h2>
          <ul>
            {setAside.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-feint py-2 text-[13.5px]">
                <span><span className="ll-figure mr-2">{item.transId}</span><span className="text-graphite-600">{item.reason}</span></span>
                <span className="flex items-baseline gap-3"><Amount cents={item.amountCents} currency={currency} />
                  {canPost && <button type="button" className={buttonClass.quiet} disabled={restore.isPending} onClick={() => restore.mutate(item)}>Back to the queue</button>}</span>
              </li>
            ))}
          </ul>
          {restore.error && <p role="alert" className="text-[13px] text-ledger-red">{(restore.error as Error).message}</p>}
        </section>
      )}
      {assigning && <AssignReceiptDialog item={assigning} onClose={() => setAssigning(null)} onDone={done} />}
      {settingAside && <SetAsideDialog item={settingAside} onClose={() => setSettingAside(null)} onDone={done} />}
    </div>
  );
}

function CashTab({ onDone }: { onDone: (message: string) => void }) {
  const { orgId, currency, canPost } = useChurchOrg();
  const { user } = useAuth();
  const userId = user?.id;
  const [confirming, setConfirming] = useState<any | null>(null);
  const [banking, setBanking] = useState<any | null>(null);
  const collections = useQuery({
    queryKey: ['collections', orgId],
    queryFn: () => apiRequest<{ collections: any[] }>('/api/collections', { fallback: 'The cash counts could not be loaded.' }),
  });
  const done = (message: string) => { setConfirming(null); setBanking(null); onDone(message); };
  if (collections.isError) return <LoadProblem what="the cash counts" path="/api/collections" onRetry={() => collections.refetch()} />;
  if (collections.isLoading || !collections.data) return <SkeletonRows label="Loading the cash counts" />;
  const list = collections.data.collections;
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[13px] text-graphite-600">Two people count every collection. The first saves the count; the second counts again from their own sign-in, and the cash posts only when both agree. Banking then moves it from cash on hand to the bank.</p>
      {list.length === 0 ? <EmptyNote>{COPY.noCounts.en}</EmptyNote> : (
        <table className="w-full text-[13.5px]">
          <caption className="sr-only">Cash counts</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 text-left">Count</th>
              <th scope="col" className="pr-3 text-left">Service</th>
              <th scope="col" className="hidden pr-3 text-left sm:table-cell">Fund</th>
              <th scope="col" className="pr-3 text-left">Where it stands</th>
              <th scope="col" className="pr-3 text-right">Counted</th>
              <th scope="col" className="text-left"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((collection) => {
              const firstCounter = userId && collection.counted_by_1 === userId;
              return (
                <tr key={collection.id} className="align-top">
                  <td className="py-2 pr-3 ll-figure">{collection.collection_number}</td>
                  <td className="py-2 pr-3">{collection.service_name}<span className="block text-[12px] text-graphite-600">{shortDate(collection.service_date)}</span></td>
                  <td className="hidden py-2 pr-3 sm:table-cell">{collection.funds?.name}</td>
                  <td className="py-2 pr-3">{COUNT_STATUS[collection.status]?.en}
                    {collection.status === 'BANKED' && Number(collection.variance_cents) !== 0 && (
                      <span className="block text-[12px] text-ledger-red">Bank received <Amount cents={Number(collection.banked_cents)} currency={currency} />, {Number(collection.variance_cents) < 0 ? 'short' : 'over'} by <Amount cents={Math.abs(Number(collection.variance_cents))} currency={currency} /></span>
                    )}</td>
                  <td className="py-2 pr-3 text-right"><Amount cents={Number(collection.total_cents)} currency={currency} /></td>
                  <td className="py-2">
                    {canPost && collection.status === 'AWAITING_SECOND_COUNT' && (firstCounter
                      ? <span className="text-[12.5px] text-graphite-600">You made the first count. Another person confirms it.</span>
                      : <button type="button" className={buttonClass.quiet} onClick={() => setConfirming(collection)}>Count it again</button>)}
                    {canPost && collection.status === 'COUNTED' && <button type="button" className={buttonClass.quiet} onClick={() => setBanking(collection)}>Bank it</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {confirming && <ConfirmCountDialog collection={confirming} onClose={() => setConfirming(null)} onDone={done} />}
      {banking && <BankCountDialog collection={banking} onClose={() => setBanking(null)} onDone={done} />}
    </div>
  );
}
