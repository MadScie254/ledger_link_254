import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { RotateCcw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export function UndoToast() {
  const { undoStack, popUndoAction, currentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const [isVisible, setIsVisible] = useState(false);
  const action = undoStack[undoStack.length - 1];

  useEffect(() => {
    if (action) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => popUndoAction(), 300); // Wait for transition
      }, 5000); // 5 seconds to undo
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [action, popUndoAction]);

  const handleUndo = async () => {
    if (!action) return;
    try {
      await fetch(action.revertEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': currentOrgId
        },
        body: JSON.stringify(action.data)
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries();
      setIsVisible(false);
      setTimeout(() => popUndoAction(), 300);
    } catch (e) {
      console.error("Undo failed", e);
    }
  };

  if (!action && !isVisible) return null;

  return (
    <div className={`fixed bottom-4 right-4 z-50 transition-all duration-300 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
      <div className="bg-ink-900 text-white  rounded-md shadow-lg p-4 flex items-center gap-4 border border-ink-900/20">
        <p className="text-sm">{action?.message || 'Action completed'}</p>
        <button 
          onClick={handleUndo}
          className="flex items-center gap-1 bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Undo
        </button>
        <button onClick={() => setIsVisible(false)} className="text-white/60 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
