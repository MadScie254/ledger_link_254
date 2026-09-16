import type { ReactNode } from 'react';

/**
 * The three argument pages are the same shape: a serif heading, a standfirst,
 * and prose. Keeping one component means the measure, rhythm and spacing stay
 * identical across them without three chances to drift.
 */
export function ProsePage({
  title,
  standfirst,
  children,
}: {
  title: string;
  standfirst: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="font-serif text-3xl font-medium tracking-tight max-w-2xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-500">{standfirst}</p>
      <div className="mt-8 border-t border-ink-900/10 pt-8">
        <div className="max-w-2xl space-y-5 text-[15px] leading-relaxed text-slate-500 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-ink-900 [&_h2]:tracking-tight [&_h2]:pt-3">
          {children}
        </div>
      </div>
    </section>
  );
}
