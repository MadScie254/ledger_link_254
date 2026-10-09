import { useEffect } from 'react';
import { useAppStore, type CreateIntent } from '../store';

/**
 * Opens the form a screen owns when New (the sidebar button, the phone tab,
 * or the N key) chose it. The intent is cleared once handled, so it opens
 * only once. Pass `enabled: false` where the person cannot post.
 */
export function useCreateIntent(handlers: Partial<Record<CreateIntent, () => void>>, enabled = true) {
  const createIntent = useAppStore((state) => state.createIntent);
  const setCreateIntent = useAppStore((state) => state.setCreateIntent);
  useEffect(() => {
    if (!createIntent) return;
    const handler = handlers[createIntent];
    if (!handler) return;
    if (enabled) handler();
    setCreateIntent(null);
    // The handlers are rebuilt each render; only a new intent should run them.
  }, [createIntent, enabled]);
}
