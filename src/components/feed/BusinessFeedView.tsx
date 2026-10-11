import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { STARTER_QUESTIONS, type AskEdition } from '../../utils/aiQuestions';
import { PageHeading, buttonClass } from '../ledger/Page';
import { VoiceQuestion, canRecordVoice } from './VoiceQuestion';

interface Answer {
  answer: string;
  question: string | null;
  title?: string;
  scope?: string;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
}

export function BusinessFeedView() {
  const { activeCompany } = useAppStore();
  const [question, setQuestion] = useState('');
  const [heard, setHeard] = useState(false);
  const [history, setHistory] = useState<Array<Answer & { asked: string; askedAt: Date }>>([]);
  const input = useRef<HTMLInputElement>(null);
  const edition: AskEdition = activeCompany?.edition === 'law' || activeCompany?.edition === 'church' ? activeCompany.edition : 'business';
  const aiOn = Boolean(activeCompany?.aiEnabled);

  const askMutation = useMutation({
    mutationFn: (q: string) => apiRequest<Answer>('/api/ai/ask', { body: { question: q }, fallback: 'No answer came back. Try the question again.' }),
    onSuccess: (answer, q) => {
      setHistory((prev) => [{ ...answer, asked: q, askedAt: new Date() }, ...prev]);
      setQuestion('');
      setHeard(false);
    },
  });

  const handleAsk = (q?: string) => {
    const finalQuestion = (q ?? question).trim();
    if (!finalQuestion || askMutation.isPending || !aiOn) return;
    askMutation.mutate(finalQuestion);
  };

  return (
    <div className="max-w-3xl space-y-5 pb-16">
      <PageHeading
        tourId="feed-overview"
        title="Business feed"
        note="Ask about this organization’s books, in English or Kiswahili. Cloudflare Workers AI picks the report that answers the question and explains it; the figures come from the books and are listed under each answer. The explanation can be wrong, so check it against the figures."
      />

      {!aiOn && (
        <p className="text-[13.5px] text-ink-900">
          Questions send this company’s figures to Cloudflare Workers AI, so they are off until an owner or admin turns on AI features in Settings, Closing and controls.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk();
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="block min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink-900">Your question</span>
          <input
            ref={input}
            type="text"
            value={question}
            maxLength={500}
            onChange={(e) => { setQuestion(e.target.value); setHeard(false); }}
            className="mt-1.5 h-10 w-full border px-3 text-[14px]"
          />
          {heard && <span className="mt-1 block text-[12.5px] text-graphite-600">This is what was heard. Correct it if needed, then ask.</span>}
        </label>
        {aiOn && canRecordVoice() && (
          <VoiceQuestion
            disabled={askMutation.isPending}
            onText={(text) => { setQuestion(text); setHeard(true); input.current?.focus(); }}
          />
        )}
        <button type="submit" disabled={!aiOn || askMutation.isPending || !question.trim()} className={`${buttonClass.primary} h-10`}>
          {askMutation.isPending ? 'Working it out' : 'Ask'}
        </button>
      </form>

      {history.length === 0 && (
        <div>
          <p className="ll-printed text-[11px] text-graphite-600">Questions to start with</p>
          <ul className="mt-2 border-t border-feint-strong">
            {STARTER_QUESTIONS[edition].map((q) => (
              <li key={q} className="border-b border-feint">
                <button
                  type="button"
                  onClick={() => handleAsk(q)}
                  disabled={!aiOn || askMutation.isPending}
                  className="w-full py-2.5 text-left text-[14px] text-ink-900 hover:text-oxblood disabled:opacity-50"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {askMutation.isError && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {(askMutation.error as Error).message}
        </p>
      )}

      {history.length > 0 && (
        <ol className="border-t-2 border-ink-900" aria-label="Answers, newest first">
          {history.map((item, idx) => (
            <li key={idx} className="border-b border-feint py-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-[14.5px] font-semibold text-ink-900">{item.asked}</p>
                <span className="shrink-0 text-[12px] text-graphite-600">{format(item.askedAt, 'HH:mm')}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-900">{item.answer}</p>
              {item.columns && item.rows && <AnswerFigures item={item} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The rows the answer was written from, as they came from the books. */
function AnswerFigures({ item }: { item: Answer }) {
  const columns = item.columns || [];
  const rows = item.rows || [];
  const numeric = (index: number) => rows.length > 0 && rows.every((row) => row[index] === null || row[index] === '' || /^[-+]?[\d,]+(\.\d+)?%?$/.test(String(row[index])));
  return (
    <details className="mt-3" open={rows.length > 0 && rows.length <= 8}>
      <summary className="cursor-pointer text-[12.5px] text-graphite-600">
        From the books: {item.title}, {item.scope} · {rows.length} {rows.length === 1 ? 'row' : 'rows'}
      </summary>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-graphite-600">Nothing recorded.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-feint-strong text-graphite-600">
                {columns.map((column, i) => (
                  <th key={column} scope="col" className={`py-1.5 pr-4 font-normal ${numeric(i) ? 'text-right' : 'text-left'}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-feint">
                  {row.map((cell, i) => (
                    <td key={i} className={`py-1.5 pr-4 text-ink-900 ${numeric(i) ? 'text-right ll-figure' : ''}`}>{cell ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
