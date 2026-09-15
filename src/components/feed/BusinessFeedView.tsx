import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Sparkles } from 'lucide-react';

const SUGGESTED_QUESTIONS = [
  'How is this business doing this month?',
  'What do we owe vendors right now?',
  'Which customers owe us money and how overdue are they?',
];

export function BusinessFeedView() {
  const { currentOrgId } = useAppStore();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Array<{ question: string; answer: string }>>([]);

  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ question: q })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to get a response');
      }
      const data = await res.json();
      return data.answer as string;
    },
    onSuccess: (answer, q) => {
      setHistory(prev => [{ question: q, answer }, ...prev]);
      setQuestion('');
    }
  });

  const handleAsk = (q?: string) => {
    const finalQuestion = (q ?? question).trim();
    if (!finalQuestion || askMutation.isPending) return;
    askMutation.mutate(finalQuestion);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-serif text-ink-900 mb-4">AI Business Feed</h1>
        <p className="text-slate-500">Ask questions about this organization's real financial data — grounded in your actual P&L, receivables, and payables.</p>
      </div>

      <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm overflow-hidden mb-4">
        <div className="p-4 border-b border-ink-900/10 bg-paper-50 flex items-center space-x-3">
           <div className="w-8 h-8 rounded-full bg-sidebar-bg flex items-center justify-center text-white shrink-0">✨</div>
           <input
             type="text"
             value={question}
             onChange={(e) => setQuestion(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(); }}
             placeholder="Ask anything (e.g. 'How is this business doing this month?')"
             className="flex-1 bg-transparent border-none outline-none text-ink-900 placeholder:text-slate-400"
           />
           <button
             onClick={() => handleAsk()}
             disabled={askMutation.isPending || !question.trim()}
             className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm disabled:opacity-50"
           >
             {askMutation.isPending ? 'Thinking...' : 'Ask'}
           </button>
        </div>
      </div>

      {history.length === 0 && (
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => handleAsk(q)}
              disabled={askMutation.isPending}
              className="text-xs px-3 py-1.5 bg-paper-100 border border-ink-900/10 rounded-full text-slate-600 hover:border-focus-blue-500/50 hover:text-ink-900 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {askMutation.isError && (
        <div className="p-4 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-sm rounded-sm">
          {(askMutation.error as Error).message}
        </div>
      )}

      <div className="space-y-4">
        {history.map((item, idx) => (
          <div key={idx} className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm p-6 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-focus-blue-500"></div>
            <div className="flex items-center space-x-2 mb-3">
              <Sparkles className="w-4 h-4 text-focus-blue-500" />
              <p className="text-sm font-semibold text-ink-900">{item.question}</p>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{item.answer}</p>
          </div>
        ))}
        {history.length === 0 && !askMutation.isPending && (
          <div className="text-center text-slate-400 text-sm py-8">
            Ask a question above to get a real, data-grounded answer.
          </div>
        )}
      </div>
    </div>
  );
}
