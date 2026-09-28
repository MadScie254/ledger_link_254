import { useCallback, useState } from 'react';
import { ConfirmModal } from '../components/layout/ConfirmModal';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  isDestructive?: boolean;
}

/**
 * Replaces window.confirm with the app's own ConfirmModal, styled to the
 * ledger-book design system rather than the browser's native dialog.
 * Render the returned confirmDialog once, anywhere in the component's JSX.
 */
export function useConfirm() {
  const [pending, setPending] = useState<(ConfirmOptions & { onConfirm: () => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions, onConfirm: () => void) => {
    setPending({ ...options, onConfirm });
  }, []);

  const confirmDialog = (
    <ConfirmModal
      isOpen={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      confirmText={pending?.confirmText}
      isDestructive={pending?.isDestructive}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        pending?.onConfirm();
        setPending(null);
      }}
    />
  );

  return { confirm, confirmDialog };
}
