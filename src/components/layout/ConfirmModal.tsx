import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  isDestructive?: boolean;
}

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirm', isDestructive = false }: ConfirmModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#111827] rounded-sm shadow-2xl max-w-sm w-full p-6 border border-ink-900/10">
        <div className="flex items-center space-x-3 mb-4">
          {isDestructive && <AlertTriangle className="w-6 h-6 text-rust-700" />}
          <h3 className="text-lg font-serif text-ink-900">{title}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900 transition-colors">
            Cancel
          </button>
          <button 
            onClick={onConfirm} 
            className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors text-white dark:text-[#0B0F19] ${isDestructive ? 'bg-rust-700 hover:bg-rust-700/90' : 'bg-ink-900 hover:bg-ink-900/90'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
