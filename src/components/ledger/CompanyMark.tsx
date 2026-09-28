import { companyInitials } from '../../utils/companyMark';

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-[13px]',
} as const;

/**
 * A company's mark wherever the app names one: the sidebar spine, the
 * company switcher, the command palette. Same bordered-square badge as an
 * icon elsewhere in the book, holding initials instead of an icon, so a
 * company is legible without a logo to upload or store.
 */
export function CompanyMark({ name, size = 'md' }: { name: string | undefined; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border border-feint-strong bg-paper-200 font-semibold text-oxblood ${SIZES[size]}`}
    >
      {companyInitials(name)}
    </span>
  );
}
