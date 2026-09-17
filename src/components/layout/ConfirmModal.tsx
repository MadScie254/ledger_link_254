import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

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
  return (
    <Dialog
      open={isOpen}
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <>
          <button type="button" onClick={onCancel} className={buttonClass.secondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={buttonClass.primary}
            data-destructive={isDestructive || undefined}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-[14px] leading-relaxed text-ink-900">{message}</p>
    </Dialog>
  );
}
