import { useEffect, useState } from 'react';
import { printedMoney } from '../../utils/printDocument';

interface GivingPage {
  church: string;
  currency: string;
  paybill: string | null;
  ways: Array<{ fund: string; fundCode: string; kind: 'EXACT' | 'PREFIX' | 'MEMBER_NUMBER'; accountNumber: string | null }>;
  campaigns: Array<{ name: string; fund: string; goalCents: number; givenCents: number; startsOn: string; endsOn: string | null; accountNumber: string | null }>;
}

const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A church's giving page, outside sign-in: how to give by M-Pesa to each
 * fund, and how each open campaign stands against its goal.
 */
export function PublicGivingPage({ token }: { token: string }) {
  const [page, setPage] = useState<GivingPage | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/public/give/${token}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setProblem((data && data.error) || 'This giving page could not be opened.'); return; }
      setPage(data as GivingPage);
      document.title = `Give to ${(data as GivingPage).church}`;
    })();
  }, [token]);

  if (problem) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-ink-900">
        <h1 className="text-[22px] font-semibold">Giving page not available</h1>
        <p className="mt-3 text-[15px] leading-relaxed">{problem}</p>
      </main>
    );
  }
  if (!page) return <main className="mx-auto max-w-xl px-4 py-16 text-[15px] text-graphite-600" role="status">Opening the giving page</main>;

  const fundWays = page.ways.filter((way) => way.accountNumber);
  const memberWay = page.ways.find((way) => way.kind === 'MEMBER_NUMBER');

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-10 text-ink-900">
      <p className="text-[13px] uppercase tracking-wide text-graphite-600">Give by M-Pesa</p>
      <h1 className="mt-1 text-[24px] font-semibold">{page.church}</h1>

      {!page.paybill ? (
        <p className="mt-6 text-[15px] leading-relaxed">The church has not yet connected its paybill. Ask the church office how to give.</p>
      ) : (
        <>
          <section className="mt-6 border-t-2 border-ink-900 pt-4" aria-label="How to give">
            <p className="text-[15px]">From the M-Pesa menu choose <strong>Lipa na M-Pesa</strong>, then <strong>Pay Bill</strong>.</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
              <dt className="text-graphite-600">Business number</dt><dd className="ll-figure text-[18px] font-semibold">{page.paybill}</dd>
            </dl>
            <h2 className="mt-5 text-[16px] font-semibold">Account number</h2>
            <ul className="mt-2 divide-y divide-feint border-y border-feint">
              {fundWays.map((way) => (
                <li key={`${way.accountNumber}`} className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
                  <span>{way.fund}</span>
                  <span className="ll-figure font-semibold">{way.accountNumber}{way.kind === 'PREFIX' ? '…' : ''}</span>
                </li>
              ))}
              {memberWay && (
                <li className="flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
                  <span>{memberWay.fund}</span>
                  <span className="text-right">Your member number</span>
                </li>
              )}
            </ul>
            {fundWays.some((way) => way.kind === 'PREFIX') && (
              <p className="mt-2 text-[13px] text-graphite-600">An account number ending in … may be followed by anything, such as your name.</p>
            )}
            <p className="mt-3 text-[13px] text-graphite-600">
              Each gift is recorded against its fund when M-Pesa confirms it.{memberWay ? ' Gifts made with your member number also appear on your giving statement.' : ''}
            </p>
          </section>

          {page.campaigns.length > 0 && (
            <section className="mt-8" aria-label="Campaigns">
              <h2 className="text-[16px] font-semibold">Campaigns</h2>
              <ul className="mt-3 space-y-5">
                {page.campaigns.map((campaign) => {
                  const share = campaign.goalCents > 0 ? Math.min(100, Math.round((campaign.givenCents / campaign.goalCents) * 100)) : 0;
                  return (
                    <li key={campaign.name}>
                      <p className="text-[15px] font-semibold">{campaign.name}</p>
                      <p className="text-[13px] text-graphite-600">
                        {campaign.fund}{campaign.endsOn ? `, until ${longDate(campaign.endsOn)}` : ''}
                        {campaign.accountNumber ? ` · account ${campaign.accountNumber}` : ''}
                      </p>
                      <div className="mt-2 h-2.5 w-full bg-paper-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}
                        aria-label={`${campaign.name}: ${share}% of the goal`}>
                        <div className="h-full bg-ink-900" style={{ width: `${share}%` }} />
                      </div>
                      <p className="mt-1 text-[13.5px] ll-figure">
                        {page.currency} {printedMoney(campaign.givenCents)} given of {printedMoney(campaign.goalCents)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="mt-12 text-[12px] text-graphite-600">Kept with Kundi by Ledger Link</p>
    </main>
  );
}
