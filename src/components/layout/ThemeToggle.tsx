import { Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store';

/**
 * Light or dark mode. The first visit follows the device's
 * setting; a choice made here is kept for the next visit, signed in or not.
 */
export function ThemeToggle({ className = 'flex h-9 w-9 items-center justify-center rounded-md text-text-2 hover:bg-hover hover:text-text' }: { className?: string }) {
  const { theme, setTheme } = useAppStore();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={className} aria-label={label} title={label}>
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
