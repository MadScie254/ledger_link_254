import { Clock3 } from 'lucide-react';
import { PageHeading } from '../ledger/Page';
import { PLANNED_EDITION_VIEWS, PLANNED_SECTION_COPY, type PlannedEditionView as PlannedView } from '../../utils/views';
import { localized, text } from '../../utils/language';

const status = localized('Planned');

/** Honest landing state for edition workflows that have no renderer yet. */
export function PlannedEditionView({ view }: { view: PlannedView }) {
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageHeading title={PLANNED_EDITION_VIEWS[view]} />
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-10">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-ink">
          <Clock3 className="size-6" aria-hidden="true" />
        </div>
        <p className="mt-5 inline-flex rounded-full bg-neutral-soft px-3 py-1 text-[12px] font-medium text-text-2">{text(status)}</p>
        <p className="mt-4 max-w-xl text-[14px] leading-6 text-text-2">{text(PLANNED_SECTION_COPY)}</p>
      </div>
    </section>
  );
}
