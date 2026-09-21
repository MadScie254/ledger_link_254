import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';

export function UndoToast() {
  const { undoStack, popUndoAction, currentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState('');
  const action = undoStack[undoStack.length - 1];

  useEffect(() => {
    if (!action) return;
    setProblem('');
    const timer = setTimeout(() => popUndoAction(), 5000);
    return () => clearTimeout(timer);
  }, [action, popUndoAction]);

  const handleUndo = async () => {
    if (!action) return;
    try {
      const res = await fetch(action.revertEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify(action.data),
      });
      if (!res.ok) throw new Error('Undo failed');
      queryClient.invalidateQueries();
      popUndoAction();
    } catch {
      setProblem('It could not be undone.');
    }
  };

  if (!action) return null;

  return (
    <div className="fixed bottom-3 right-3 left-3 z-50 sm:left-auto" role="status">
      <div className="ll-lift flex items-center gap-4 border border-feint-strong border-t-2 border-t-ink-900 bg-paper-100 px-3.5 py-2.5">
        <p className="min-w-0 flex-1 text-[13.5px] text-ink-900">
          {action.message || 'Done.'}
          {problem && <span className="block text-[12.5px] text-ledger-red">{problem}</span>}
        </p>
        <button type="button" onClick={handleUndo} className="text-[13.5px] font-semibold text-oxblood underline underline-offset-[3px]">
          Undo
        </button>
        <button type="button" onClick={() => popUndoAction()} aria-label="Dismiss" className="text-graphite-600 hover:text-ink-900">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
