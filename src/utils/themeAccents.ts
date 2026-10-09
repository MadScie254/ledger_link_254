/** Persisted accent IDs stay stable while their presentation follows the new palette. */

export type ThemeAccent = 'oxblood' | 'forest' | 'navy' | 'plum' | 'slate';

export interface ThemeAccentDefinition {
  id: ThemeAccent;
  label: string;
  swatch: string;
}

export const THEME_ACCENTS: ThemeAccentDefinition[] = [
  { id: 'oxblood', label: 'Evergreen', swatch: '#0E7A5B' },
  { id: 'forest', label: 'Pine', swatch: '#25735D' },
  { id: 'navy', label: 'Indigo', swatch: '#2457C5' },
  { id: 'plum', label: 'Plum', swatch: '#7A3A86' },
  { id: 'slate', label: 'Slate', swatch: '#465467' },
];

export const DEFAULT_THEME_ACCENT: ThemeAccent = 'oxblood';

export function applyThemeAccent(accent: ThemeAccent | null | undefined) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-accent', accent || DEFAULT_THEME_ACCENT);
}
