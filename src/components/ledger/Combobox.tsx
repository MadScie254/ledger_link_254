import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ComboboxOption { value: string; label: string }

/** A searchable single choice. The parent owns the selected value. */
export function Combobox({ value, onChange, options, placeholder = 'Choose', disabled = false, required = false, name, 'aria-label': ariaLabel, className = '' }: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const selected = options.find((option) => option.value === value);
  const shown = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes((search || '').toLocaleLowerCase())), [options, search]);
  const pick = (next: string) => {
    onChange(next);
    setSearch(null);
    setOpen(false);
  };

  return (
    <span className={`relative block ${className}`}>
      <span className="relative block">
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          name={name}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          value={search === null ? selected?.label || '' : search}
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => { setSearch(''); setActive(-1); setOpen(true); }}
          onChange={(event) => { if (value) onChange(''); setSearch(event.target.value); setActive(-1); setOpen(true); }}
          onBlur={() => { setOpen(false); setSearch(null); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) => event.key === 'ArrowDown'
                ? Math.min(shown.length - 1, index + 1)
                : index < 0 ? shown.length - 1 : Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && shown[active]) {
              event.preventDefault();
              pick(shown[active].value);
            } else if (event.key === 'Escape' && open) {
              event.stopPropagation();
              setOpen(false);
              setSearch(null);
            }
          }}
          className="h-9 w-full rounded-lg border border-border-strong bg-surface px-3 pr-9 text-[14px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 size-4 text-text-3" />
      </span>
      {open && !disabled && (
        <span id={listId} role="listbox" className="absolute z-[90] mt-1 block max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md">
          {shown.length ? shown.map((option, index) => (
            <span
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); pick(option.value); }}
              className={`block cursor-pointer rounded-md px-3 py-2 text-[14px] text-text ${index === active ? 'bg-primary-soft' : 'hover:bg-hover'}`}
            >{option.label}</span>
          )) : <span className="block px-3 py-2 text-[13px] text-text-3">No matches</span>}
        </span>
      )}
    </span>
  );
}
