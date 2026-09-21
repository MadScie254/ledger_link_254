import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAppStore } from '../../store';
import { PageHeading, buttonClass } from '../ledger/Page';

const SUGGESTED_QUESTIONS = [
  'How is this business doing this month?',
  'What do we owe suppliers right now?',
  'Which customers owe us money, and how overdue are they?',
];

export function BusinessFeedView() {
  const { currentOrgId } = useAppStore();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Array<{ question: string; answer: string; askedAt: Date }>>([]);

  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No answer came back. Try the question again.');
      }
      const data = await res.json();
      return data.answer as string;
    },
    onSuccess: (answer, q) => {
      setHistory((prev) => [{ question: q, answer, askedAt: new Date() }, ...prev]);
      setQuestion('');
    },
  });

  const handleAsk = (q?: string) => {
    const finalQuestion = (q ?? question).trim();
    if (!finalQuestion || askMutation.isPending) return;
    askMutation.mutate(finalQuestion);
  };

  return (
    <div className="max-w-3xl space-y-5 pb-16">
      <PageHeading
        tourId="feed-overview"
        title="Business feed"
        note="Ask about this organization’s books. Gemini writes each answer from the posted P&L, receivables and payables it is given, and it can be wrong. Check a figure against Reports before acting on it."
      />

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
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="mt-1.5 h-10 w-full border px-3 text-[14px]"
          />
        </label>
        <button type="submit" disabled={askMutation.isPending || !question.trim()} className={`${buttonClass.primary} h-10`}>
          {askMutation.isPending ? 'Writing the answer' : 'Ask'}
        </button>
      </form>

      {history.length === 0 && (
        <div>
          <p className="ll-printed text-[11px] text-graphite-600">Questions to start with</p>
          <ul className="mt-2 border-t border-feint-strong">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q} className="border-b border-feint">
                <button
                  type="button"
                  onClick={() => handleAsk(q)}
                  disabled={askMutation.isPending}
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
                <p className="text-[14.5px] font-semibold text-ink-900">{item.question}</p>
                <span className="shrink-0 text-[12px] text-graphite-600">{format(item.askedAt, 'HH:mm')}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-900">{item.answer}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
