import { Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store';

/**
 * Paper (light) or carbon (dark). The first visit follows the device's
 * setting; a choice made here is kept for the next visit, signed in or not.
 */
export function ThemeToggle({ className = 'p-2 text-graphite-600 hover:text-ink-900' }: { className?: string }) {
  const { theme, setTheme } = useAppStore();
  const label = theme === 'dark' ? 'Switch to paper (light)' : 'Switch to carbon (dark)';
  return (
    <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={className} aria-label={label} title={label}>
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
