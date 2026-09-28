/**
 * A company's own accent color, in place of the default oxblood. Only the
 * brand accent changes (the primary button, the sidebar spine, focus rings);
 * entered-figure blue, loss and error red, and the tick green are the same on
 * every accent (see index.css). `swatch` is the colour actually shown for
 * each option's button, matched to what that accent looks like on paper.
 */

export type ThemeAccent = 'oxblood' | 'forest' | 'navy' | 'plum' | 'slate';

export interface ThemeAccentDefinition {
  id: ThemeAccent;
  label: string;
  swatch: string;
}

export const THEME_ACCENTS: ThemeAccentDefinition[] = [
  { id: 'oxblood', label: 'Oxblood', swatch: '#5A1A1F' },
  { id: 'forest', label: 'Forest', swatch: '#1F4B3A' },
  { id: 'navy', label: 'Navy', swatch: '#1E2A52' },
  { id: 'plum', label: 'Plum', swatch: '#4A1F4E' },
  { id: 'slate', label: 'Slate', swatch: '#2B3542' },
];

export const DEFAULT_THEME_ACCENT: ThemeAccent = 'oxblood';

export function applyThemeAccent(accent: ThemeAccent | null | undefined) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-accent', accent || DEFAULT_THEME_ACCENT);
}
