import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bug,
  Building2,
  Check,
  CheckCircle2,
  Clipboard,
  Cloud,
  Code2,
  Compass,
  Copy,
  Database,
  FileText,
  Landmark,
  Layers3,
  LifeBuoy,
  ListChecks,
  PackageCheck,
  ReceiptText,
  Search,
  ShieldCheck,
  Siren,
  TerminalSquare,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { useOnboarding } from '../onboarding/OnboardingProvider';
import { PageHeading, buttonClass } from '../ledger/Page';
import {
  CATEGORY_LABELS,
  documentationSections,
  searchableSectionText,
  type DocumentationBlock,
  type DocumentationCategory,
  type DocumentationSection,
} from './documentationContent';

type CategoryFilter = 'all' | DocumentationCategory;

const CATEGORY_ICONS: Record<DocumentationCategory, LucideIcon> = {
  start: Compass,
  business: Clipboard,
  technical: TerminalSquare,
  troubleshooting: Wrench,
  reference: BookOpen,
};

const CONTENT_ICONS: Record<string, LucideIcon> = {
  compass: Compass,
  building: Building2,
  invoice: FileText,
  receipt: ReceiptText,
  bank: Landmark,
  ledger: BookOpen,
  operations: PackageCheck,
  shield: ShieldCheck,
  architecture: Layers3,
  terminal: TerminalSquare,
  database: Database,
  api: Code2,
  cloud: Cloud,
  activity: Activity,
  'life-buoy': LifeBuoy,
  bug: Bug,
  siren: Siren,
  book: BookOpen,
};

const FILTERS: CategoryFilter[] = ['all', 'start', 'business', 'technical', 'troubleshooting', 'reference'];

export function DocumentationView() {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const { restartTutorial, isReady: tutorialReady } = useOnboarding();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [copiedCode, setCopiedCode] = useState('');

  const visibleSections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return documentationSections.filter((section) => {
      if (category !== 'all' && section.category !== category) return false;
      return !normalized || searchableSectionText(section).includes(normalized);
    });
  }, [category, query]);

  const jumpTo = (id: string) => {
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copyCode = async (key: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(key);
      window.setTimeout(() => setCopiedCode((current) => (current === key ? '' : current)), 1800);
    } catch {
      setCopiedCode('');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeading
        tourId="documentation-overview"
        title="Documentation center"
        note="Step-by-step product tutorials, SaaS operations, troubleshooting, and engineering runbooks"
        actions={
          <button type="button" onClick={restartTutorial} disabled={!tutorialReady} className={buttonClass.secondary}>
            <Compass className="h-4 w-4" aria-hidden="true" /> Restart product tour
          </button>
        }
      />

      <section aria-labelledby="choose-path-heading">
        <div className="flex flex-col gap-4 border-b border-feint-strong pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="choose-path-heading" className="ll-heading text-[21px] text-ink-900">Choose a path</h2>
            <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-graphite-600">
              Start with the job being done. Business chapters explain the clicks and accounting result; technical chapters explain the system boundary, evidence, and recovery path.
            </p>
          </div>
          <label className="relative block w-full lg:w-[25rem]">
            <span className="sr-only">Search documentation</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search errors, workflows, API, deployment…"
              className="h-10 w-full rounded-sm border border-field bg-paper-100 pl-9 pr-10 text-[13.5px] text-ink-900 placeholder:text-graphite-500 focus:border-oxblood focus:outline-none focus:shadow-[0_0_0_1px_var(--oxblood)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-graphite-500 hover:text-ink-900"
                aria-label="Clear documentation search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </label>
        </div>

        <div role="tablist" aria-label="Documentation categories" className="flex snap-x gap-0 overflow-x-auto border-b border-feint-strong [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((filter) => {
            const selected = category === filter;
            const Icon = filter === 'all' ? BookOpen : CATEGORY_ICONS[filter];
            const count = filter === 'all' ? documentationSections.length : documentationSections.filter((section) => section.category === filter).length;
            return (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setCategory(filter)}
                className={`-mb-px flex shrink-0 snap-start items-center gap-2 border-b-2 px-3 py-3 text-[13px] sm:px-4 ${
                  selected ? 'border-oxblood font-semibold text-ink-900' : 'border-transparent text-graphite-600 hover:text-ink-900'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{filter === 'all' ? 'All chapters' : CATEGORY_LABELS[filter]}</span>
                <span className="ll-figure text-[11px] text-graphite-500">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-20" aria-label="Documentation contents">
          <div className="border-b-2 border-ink-900 pb-2">
            <h2 className="ll-printed text-[11px] text-graphite-600">On this page</h2>
            <p className="mt-1 text-[12.5px] text-graphite-500">
              {visibleSections.length} {visibleSections.length === 1 ? 'chapter' : 'chapters'}
            </p>
          </div>
          {visibleSections.length > 0 ? (
            <ol className="max-h-[calc(100vh-10rem)] overflow-y-auto border-b border-feint-strong">
              {visibleSections.map((section, index) => {
                const Icon = CONTENT_ICONS[section.icon] || BookOpen;
                return (
                  <li key={section.id} className="border-b border-feint last:border-b-0">
                    <button type="button" onClick={() => jumpTo(section.id)} className="group flex w-full items-start gap-2.5 py-2.5 text-left">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-feint-strong bg-paper-200 text-oxblood">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] text-graphite-500">{String(index + 1).padStart(2, '0')} · {section.minutes} min</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-900 group-hover:underline group-hover:underline-offset-[3px]">{section.title}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="py-4 text-[13px] text-graphite-600">No chapter matches this search and category.</p>
          )}
        </aside>

        <main className="min-w-0" aria-label="Documentation chapters">
          {visibleSections.length === 0 ? (
            <div className="ll-margin max-w-2xl py-10 pl-6">
              <Search className="h-6 w-6 text-oxblood" aria-hidden="true" />
              <h2 className="ll-heading mt-4 text-[22px] text-ink-900">No matching documentation</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">Try a shorter phrase, clear the category, or search by an error code such as 401, 403, CORS, migration, invoice, or payroll.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
                className={`${buttonClass.secondary} mt-4`}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-14">
              {visibleSections.map((section, index) => (
                <DocumentationArticle
                  key={section.id}
                  section={section}
                  number={index + 1}
                  onOpenView={setActiveView}
                  copiedCode={copiedCode}
                  onCopyCode={copyCode}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function DocumentationArticle({
  section,
  number,
  onOpenView,
  copiedCode,
  onCopyCode,
}: {
  section: DocumentationSection;
  number: number;
  onOpenView: (view: string) => void;
  copiedCode: string;
  onCopyCode: (key: string, code: string) => void;
}) {
  const Icon = CONTENT_ICONS[section.icon] || BookOpen;

  return (
    <article id={`doc-${section.id}`} className="scroll-mt-20 border-t-2 border-ink-900 pt-4">
      <header className="flex flex-col gap-4 border-b border-feint-strong pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-feint-strong bg-paper-200 text-oxblood" aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="ll-printed text-[10.5px] text-graphite-500">Chapter {String(number).padStart(2, '0')} · {CATEGORY_LABELS[section.category]}</p>
            <h2 className="ll-heading mt-1 text-[24px] leading-tight text-ink-900 sm:text-[28px]">{section.title}</h2>
            <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-graphite-600">{section.summary}</p>
            <p className="mt-2 text-[12px] text-graphite-500">For {section.audience} · Approximately {section.minutes} minutes</p>
          </div>
        </div>
        {section.openView && (
          <button type="button" onClick={() => onOpenView(section.openView!)} className={`${buttonClass.secondary} shrink-0`}>
            {section.openLabel || `Open ${section.openView}`} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="mt-6 space-y-8">
        {section.blocks.map((block, blockIndex) => (
          <DocumentationBlockView
            key={`${section.id}-${blockIndex}`}
            block={block}
            codeKey={`${section.id}-${blockIndex}`}
            copied={copiedCode === `${section.id}-${blockIndex}`}
            onCopy={onCopyCode}
          />
        ))}
      </div>
    </article>
  );
}

function DocumentationBlockView({
  block,
  codeKey,
  copied,
  onCopy,
}: {
  block: DocumentationBlock;
  codeKey: string;
  copied: boolean;
  onCopy: (key: string, code: string) => void;
}) {
  if (block.type === 'text') {
    return (
      <section>
        {block.title && <BlockHeading icon={BookOpen}>{block.title}</BlockHeading>}
        <div className="mt-3 max-w-4xl space-y-3 text-[13.5px] leading-6 text-graphite-700">
          {block.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </section>
    );
  }

  if (block.type === 'steps') {
    return (
      <section>
        <BlockHeading icon={ListChecks}>{block.title}</BlockHeading>
        {block.intro && <p className="mt-2 max-w-3xl text-[13px] text-graphite-600">{block.intro}</p>}
        <ol className="mt-3 border-t border-feint-strong">
          {block.steps.map((step, index) => (
            <li key={`${step.title}-${index}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-feint py-3.5 sm:grid-cols-[2.5rem_minmax(10rem,15rem)_minmax(0,1fr)] sm:gap-4">
              <span className="ll-figure flex h-7 w-7 items-center justify-center border border-oxblood text-[12px] font-semibold text-oxblood">{index + 1}</span>
              <h4 className="pt-1 text-[13.5px] font-semibold text-ink-900">{step.title}</h4>
              <div className="col-start-2 text-[13px] leading-relaxed text-graphite-600 sm:col-start-3 sm:pt-1">
                <p>{step.detail}</p>
                {step.result && <p className="mt-1.5 text-auditor-green"><span className="font-semibold">Expected result:</span> {step.result}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (block.type === 'checklist') {
    return (
      <section>
        <BlockHeading icon={CheckCircle2}>{block.title}</BlockHeading>
        <ul className="mt-3 grid grid-cols-1 gap-x-8 border-t border-feint-strong lg:grid-cols-2">
          {block.items.map((item) => (
            <li key={item} className="flex gap-2.5 border-b border-feint py-3 text-[13px] leading-relaxed text-graphite-700">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-auditor-green" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (block.type === 'table') {
    return (
      <section>
        <BlockHeading icon={Layers3}>{block.title}</BlockHeading>
        <div className="relative mt-3 overflow-x-auto border-t border-feint-strong">
          <table className="w-full min-w-[42rem] text-[13px]">
            <thead>
              <tr>
                {block.columns.map((column) => <th key={column} scope="col" className="pr-5 text-left last:pr-0">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cellIndex}-${cell}`} className={`pr-5 align-top leading-relaxed last:pr-0 ${cellIndex === 0 ? 'font-semibold text-ink-900' : 'text-graphite-600'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (block.type === 'code') {
    return (
      <section>
        <BlockHeading icon={TerminalSquare}>{block.title}</BlockHeading>
        <div className="mt-3 border border-feint-strong bg-[var(--spine)] text-[var(--spine-ink)]">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--spine-rule)] px-3 py-2">
            <span className="ll-printed text-[10.5px] text-[var(--spine-muted)]">{block.language}</span>
            <button type="button" onClick={() => onCopy(codeKey, block.code)} className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--spine-muted)] hover:text-[var(--spine-ink)]">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-4 text-[12px] leading-5"><code>{block.code}</code></pre>
        </div>
        {block.note && <p className="mt-2 text-[12.5px] leading-relaxed text-graphite-600">{block.note}</p>}
      </section>
    );
  }

  const tone = {
    note: { Icon: LifeBuoy, border: 'border-oxblood', icon: 'text-oxblood', background: 'bg-focus-blue-50' },
    warning: { Icon: AlertTriangle, border: 'border-pending', icon: 'text-pending', background: 'bg-pending-sheet/35' },
    success: { Icon: CheckCircle2, border: 'border-auditor-green', icon: 'text-auditor-green', background: 'bg-ledger-green-50' },
  }[block.tone];
  const CalloutIcon = tone.Icon;

  return (
    <aside className={`border-l-2 ${tone.border} ${tone.background} px-4 py-3.5`}>
      <div className="flex items-start gap-3">
        <CalloutIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden="true" />
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink-900">{block.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-graphite-700">{block.text}</p>
        </div>
      </div>
    </aside>
  );
}

function BlockHeading({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <h3 className="flex items-center gap-2 border-b border-feint-strong pb-2 ll-heading text-[18px] text-ink-900">
      <Icon className="h-4 w-4 text-oxblood" aria-hidden="true" />
      {children}
    </h3>
  );
}
