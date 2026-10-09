import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  FileCheck2,
  Landmark,
  Layers,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { BrandMark } from '../components/ledger/BrandMark';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { BUSINESS_BRAND } from '../hooks/usePublicBrand';
import type { PublicBrand } from '../utils/publicBrand';

/**
 * Ledger Link's public face: what the product does, how it works, and how to
 * start, for a visitor who has not signed in yet. Persuade mode, not Operate
 * mode: this page argues a case, so it earns a little more visual weight than
 * the working screens behind it, still built from the same type, spacing and
 * palette so the two feel like one product rather than two different sites.
 */

const NAV_LINKS = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'features', label: 'Features' },
  { id: 'editions', label: 'Editions' },
  { id: 'security', label: 'Security' },
  { id: 'faq', label: 'FAQ' },
];

const TRUST_MARKS = [
  { icon: ScrollText, label: 'VAT and withholding tax on each document' },
  { icon: ShieldCheck, label: 'Row-level tenant isolation' },
  { icon: Layers, label: 'Double-entry, always balanced' },
];

const SETUP_STEPS = [
  { title: 'Create an account', body: 'Sign up with a work email. No card required to start.' },
  { title: 'Say what it is', body: 'A business, a law firm or a church. It decides the accounts that open first.' },
  { title: 'The books are ready', body: 'A chart of accounts is seeded for it. Nothing to set up by hand.' },
  { title: 'Record the first sale', body: 'An invoice, a bill or a bank line, posted to the ledger as it is saved.' },
];

const FEATURES: { icon: typeof BookOpen; title: string; body: string }[] = [
  { icon: FileCheck2, title: 'Invoices, bills and the papers around them', body: 'Estimates, sales and purchase orders, invoices, bills, credit notes and recurring documents, each printed as a PDF. VAT is worked out on each line, and the posting to the ledger happens without a second step.' },
  { icon: Wallet, title: 'Payments as they really arrive', body: 'One customer payment shared across several invoices. Tax a customer withheld, recorded against its KRA certificate number. A dollar invoice settled at the day\'s rate, with the exchange gain or loss posted.' },
  { icon: Landmark, title: 'Banking and M-Pesa matching', body: 'Bank and M-Pesa statements import as CSV, OFX or QFX, get matched to the invoice or bill they settle, with rules for the lines that repeat, and each account reconciles to its statement.' },
  { icon: Users, title: 'Payroll and statutory deductions', body: 'PAYE, NSSF, SHA and the Housing Levy calculated from gross pay, with the filing dates tracked against the Kenyan calendar.' },
  { icon: BarChart3, title: 'Reports that read themselves', body: 'Profit and loss (also by class or location), balance sheet, cash flow, VAT summary, aging and customer statements, built from what has already been posted.' },
  { icon: ShieldCheck, title: 'Roles and approvals for a real team', body: 'An owner, admin or accountant posts; a member reads. A bill over the approval limit waits for someone who did not enter it, and every change is in an audit log that cannot be edited.' },
];

/** What each edition adds on top of the shared ledger. Each point is built and tested; the Daraja connection is marked as pilot. */
const EDITIONS: { edition: 'law' | 'church'; name: string; audience: string; points: string[] }[] = [
  {
    edition: 'law', name: 'Mizani', audience: 'For law firms',
    points: [
      'Matters, opened after a conflict search across clients and parties.',
      'A court diary with outcomes and next dates, and a private calendar feed for each advocate.',
      'Time at the matter\'s rate and office disbursements, waiting to be billed.',
      'A client account kept apart from office money, refused if it would go overdrawn.',
      'Fee notes raised from unbilled work, settled from client money or paid net of withholding.',
    ],
  },
  {
    edition: 'church', name: 'Kundi', audience: 'For churches',
    points: [
      'A member register and households, imported from a spreadsheet.',
      'M-Pesa giving from the paybill statement, placed on each member by the reference they typed. A direct Daraja paybill connection is in pilot.',
      'Sunday cash counted by two people before it is banked, with any shortfall recorded.',
      'Funds such as building, missions and welfare kept apart in the same books.',
      'A monthly treasurer\'s report as a PDF, and fund balances that agree with the ledger.',
    ],
  },
];

const FAQS = [
  {
    q: 'Do I need any accounting background to use this?',
    a: 'No. The tour and the in-app documentation are written for someone who has never used bookkeeping software, and every screen explains the accounting term the first time it uses it.',
  },
  {
    q: 'What does choosing a business type actually change?',
    a: 'It adds a few accounts suited to that kind of work to the standard chart of accounts, and it reorders the sidebar so the pages you need most come first. Nothing is ever hidden or removed, and it can be changed later from Settings.',
  },
  {
    q: 'Is there a version for law firms or churches?',
    a: 'Yes. Mizani is the edition for law firms: matters, the court diary, time, the client account and fee notes. Kundi is the edition for churches: members, giving, Sunday cash counts, funds and the treasurer\'s report. The edition is chosen once, when the organization is created, and both post to the same double-entry ledger.',
  },
  {
    q: 'Is eTIMS submission built in?',
    a: 'Not yet. Each invoice is logged in the eTIMS queue on the Tax page, where it waits for a connected KRA device; sending the queue to KRA is not built. Nothing is shown as submitted to KRA. A law firm can record a fee note\'s eTIMS invoice number by hand.',
  },
  {
    q: 'Can more than one person work on the same books?',
    a: 'Yes. Invite a teammate from Team settings and choose their role. An owner, admin or accountant can post to the books; a member can read them.',
  },
  {
    q: 'Where is the data kept?',
    a: 'In a Postgres database with row-level security scoped to your organization, behind a Cloudflare Worker holding the only key able to write to it. Nobody outside your organization can query your rows, by database policy rather than by application code alone.',
  },
  {
    q: 'What does it cost?',
    a: 'Ledger Link is being built with early users right now. Sign up and the team will reach out directly about pricing before anything is charged.',
  },
];

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
  brand?: PublicBrand;
}

export function LandingPage({ onSignIn, onSignUp, brand = BUSINESS_BRAND }: LandingPageProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const reducedMotion = useReducedMotion();

  const scrollTo = (id: string) => {
    setIsMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (brand.edition !== 'business') {
    const audience = brand.edition === 'law' ? 'law firms' : 'churches';
    const edition = EDITIONS.find((entry) => entry.edition === brand.edition)!;
    const summary = brand.edition === 'law'
      ? 'Matters, the court diary, time, client money and fee notes, in one set of double-entry books. Client money is kept apart from office money and can never be overdrawn.'
      : 'Members, giving, Sunday collections and funds, in one set of double-entry books. Each gift lands in its fund, and the treasurer\'s report comes from the same ledger.';
    const startLabel = { en: 'Create account', sw: 'TODO-SW' };
    const signInLabel = { en: 'Sign in', sw: 'TODO-SW' };
    return <main className="min-h-screen bg-canvas text-text">
      <header className="border-b border-border bg-surface/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <span className="flex items-center gap-2 font-display text-[16px] font-bold">
            <BrandMark edition={brand.edition} className="h-5 w-5 text-primary" /> {brand.brandName}
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button type="button" onClick={onSignIn} className="rounded-lg px-3 py-2 text-[13.5px] font-semibold text-primary-ink hover:bg-primary-soft">
              {signInLabel.en}
            </button>
          </div>
        </div>
      </header>
      <section className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1.4fr_1fr] md:py-28">
        <div>
          <p className="text-[12px] font-semibold text-primary-ink">{brand.brandName} · {edition.audience}</p>
          <h1 className="mt-5 max-w-2xl ll-cover text-[44px] leading-[1.08] sm:text-[62px]">
            One set of books for {audience}.
          </h1>
          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-graphite-600">{summary}</p>
          <button type="button" onClick={onSignUp}
            className="mt-9 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[14px] font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
            {startLabel.en} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <p className="mt-4 text-[12px] text-graphite-600">powered by Ledger Link</p>
        </div>
        <aside className="self-start rounded-2xl border border-border bg-surface p-8 shadow-md">
          <p className="text-[12px] font-semibold text-text-2">What opens with the organization</p>
          <ul className="mt-5 space-y-4 text-[14px] leading-relaxed">
            {edition.points.map((point) => <li key={point}>{point}</li>)}
            <li>Full books: the chart of accounts, journal entries and trial balance, for owners, admins and accountants.</li>
          </ul>
        </aside>
      </section>
    </main>;
  }

  return (
    <motion.div
      className="min-h-screen bg-canvas text-text"
      initial={reducedMotion ? false : { opacity: 0, x: -28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft" aria-hidden="true">
              <BrandMark className="h-4 w-4 text-primary" />
            </span>
            <span className="font-display text-[15px] font-bold text-text">Ledger Link</span>
          </div>

          <nav aria-label="Page sections" className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((link) => (
              <button key={link.id} type="button" onClick={() => scrollTo(link.id)} className="text-[13.5px] text-graphite-600 hover:text-ink-900">
                {link.label}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <button type="button" onClick={onSignIn} className="h-9 px-3 text-[13.5px] font-semibold text-ink-900 hover:text-oxblood">
              Sign in
            </button>
            <button type="button" onClick={onSignUp} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-semibold text-on-primary hover:bg-primary-hover">
              Get started <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button type="button" onClick={() => setIsMenuOpen((open) => !open)} className="p-2 text-ink-900" aria-label={isMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={isMenuOpen}>
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="border-t border-feint-strong bg-paper-50 px-5 py-4 md:hidden">
            <nav aria-label="Page sections" className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <button key={link.id} type="button" onClick={() => scrollTo(link.id)} className="py-2 text-left text-[14px] text-ink-900">
                  {link.label}
                </button>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-feint pt-3">
              <button type="button" onClick={onSignIn} className="h-10 rounded-lg border border-border-strong bg-surface text-[14px] font-semibold text-text">
                Sign in
              </button>
              <button type="button" onClick={onSignUp} className="h-10 rounded-lg bg-primary text-[14px] font-semibold text-on-primary">
                Get started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-10">
          <div>
            <p className="text-[12px] font-semibold text-primary-ink">Double-entry bookkeeping for Kenyan businesses</p>
            <h1 className="ll-cover mt-4 text-[38px] leading-[1.08] text-text sm:text-[52px]">
              Every invoice, bill and payment, posted to one ledger.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-graphite-600 sm:text-[17px]">
              Ledger Link records sales, bills, bank activity and payroll as one set of books, in the accounts and
              currencies a Kenyan business actually uses. No spreadsheet reconciled by hand, no accountant waiting
              on a month-end export.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onSignUp} className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
                Get started free <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => scrollTo('how-it-works')} className="inline-flex h-12 items-center gap-2 rounded-lg border border-border-strong bg-surface px-5 text-[15px] font-semibold text-text hover:bg-hover">
                See how it works
              </button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-feint-strong pt-6 sm:max-w-md">
              <div>
                <dt className="ll-printed text-[10.5px] text-graphite-600">Ledger</dt>
                <dd className="mt-1 text-[13.5px] text-ink-900">Always balanced</dd>
              </div>
              <div>
                <dt className="ll-printed text-[10.5px] text-graphite-600">Currency</dt>
                <dd className="mt-1 text-[13.5px] text-ink-900">KES and 11 others</dd>
              </div>
              <div>
                <dt className="ll-printed text-[10.5px] text-graphite-600">Built for</dt>
                <dd className="mt-1 text-[13.5px] text-ink-900">SMEs, law firms, churches</dd>
              </div>
            </dl>
          </div>

          <HeroLedgerPreview />
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-feint-strong pt-6">
          {TRUST_MARKS.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2 text-[13px] text-graphite-600">
              <Icon className="h-4 w-4 text-oxblood" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-feint-strong bg-paper-100 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionHeading eyebrow="How it works" title="From sign-up to a posted entry, in four steps" note="Every step happens inside the product. There is no import spreadsheet to fill in first." />
          <div className="mt-12">
            <SetupFlowDiagram />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionHeading eyebrow="Features" title="One ledger behind every screen" note="Nothing here is a separate app bolted on. An invoice, a bank match and a payroll run all post to the same accounts." />
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-border bg-surface p-6 shadow-sm">
                <feature.icon className="h-5 w-5 text-oxblood" aria-hidden="true" />
                <h3 className="ll-heading mt-4 text-[18px] text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Editions */}
      <section id="editions" className="border-t border-feint-strong py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionHeading eyebrow="Editions" title="The same ledger, set out for law firms and churches" note="Choose the edition when the organization is created. Each opens with its own chart of accounts, sidebar and Home, and posts to the same double-entry books." />
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden border border-feint-strong bg-feint-strong md:grid-cols-2">
            {EDITIONS.map((edition) => (
              <div key={edition.name} className="bg-paper-50 p-6 sm:p-8">
                <p className="flex items-center gap-2">
                  <BrandMark edition={edition.edition} className="h-5 w-5 text-oxblood" />
                  <span className="ll-heading text-[20px] text-ink-900">{edition.name}</span>
                  <span className="ll-printed text-[11px] text-graphite-600">{edition.audience}</span>
                </p>
                <ul className="mt-5 space-y-3">
                  {edition.points.map((point) => (
                    <li key={point} className="border-b border-feint pb-3 text-[13.5px] leading-relaxed text-graphite-600 last:border-b-0 last:pb-0">{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture / flow diagram */}
      <section className="border-t border-feint-strong bg-paper-100 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionHeading eyebrow="Under the hood" title="Where a record goes when you post it" note="The same path for an invoice, a bill or a payroll run, so the books can never drift from what the screens show." />
          <div className="mt-12">
            <PostingFlowDiagram />
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div>
              <SectionHeading eyebrow="Security" title="Isolation by database policy, not by good intentions" />
            </div>
            <dl className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <SecurityPoint icon={ShieldCheck} title="Row-level security" body="Every table is scoped to an organization at the database layer. A signed-in person can query only the rows their membership allows, whatever the application code does." />
              <SecurityPoint icon={Landmark} title="A single writing service" body="All postings run through a Cloudflare Worker holding the one key able to write financial data. The browser never holds that key." />
              <SecurityPoint icon={ScrollText} title="An audit log that cannot be edited" body="Every change to accounts, entries and the team is written once, in order, and stays there for as long as the organization exists." />
              <SecurityPoint icon={Building2} title="One set of books per organization" body="Adding a second company never mixes its records with the first. Each organization's chart of accounts, ledger and team are entirely its own." />
            </dl>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-t border-feint-strong bg-paper-100 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <SectionHeading eyebrow="Early users" title="What people using it say" />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Testimonial
              quote="Ledger Link keeps invoices, bank matching and payroll in one place instead of three spreadsheets. It is the tool I wanted before I had time to build it myself."
              name="Daniel Wanjala"
              role="Developer, Danko Analytics"
            />
            <TestimonialPending role="Finance, Kingdom Hospital" />
            <TestimonialPending role="Kingdom Hospital" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
          <div className="mt-10 space-y-3">
            {FAQS.map((faq, index) => {
              const open = openFaq === index;
              return (
                <div key={faq.q} className="rounded-xl border border-border bg-surface px-5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left"
                  >
                    <span className="text-[15px] font-semibold text-ink-900">{faq.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-graphite-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {open && <p className="max-w-2xl pb-5 text-[14px] leading-relaxed text-graphite-600">{faq.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-feint-strong bg-paper-100">
        <div className="mx-auto max-w-4xl px-5 py-16 text-center sm:px-8 sm:py-24">
          <h2 className="ll-cover text-[32px] leading-tight text-ink-900 sm:text-[40px]">Open the books, in a few minutes.</h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-graphite-600">
            No card required to start. Choose what kind of business this is, and the books are ready.
          </p>
          <button type="button" onClick={onSignUp} className="mx-auto mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
            Get started free <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <footer className="border-t border-feint-strong">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft" aria-hidden="true">
              <BrandMark className="h-4 w-4 text-primary" />
            </span>
            <span className="font-display text-[13px] font-bold text-text">Ledger Link</span>
          </div>
          <p className="text-[12.5px] text-graphite-500">Double-entry bookkeeping for Kenyan businesses, law firms and churches. Built in Nairobi.</p>
        </div>
      </footer>
    </motion.div>
  );
}

function SectionHeading({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[12px] font-semibold text-primary-ink">{eyebrow}</p>
      <h2 className="ll-cover mt-3 text-[28px] leading-tight text-ink-900 sm:text-[34px]">{title}</h2>
      {note && <p className="mt-3 text-[14.5px] leading-relaxed text-graphite-600">{note}</p>}
    </div>
  );
}

function SecurityPoint({ icon: Icon, title, body }: { icon: typeof ShieldCheck; title: string; body: string }) {
  return (
    <div>
      <dt className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft" aria-hidden="true">
          <Icon className="h-4 w-4 text-primary" />
        </span>
        <span className="text-[14.5px] font-semibold text-ink-900">{title}</span>
      </dt>
      <dd className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">{body}</dd>
    </div>
  );
}

function Testimonial({ quote, name, role }: { quote: string; name: string; role: string }) {
  return (
    <figure className="flex h-full flex-col rounded-xl border border-border bg-surface p-6 shadow-sm">
      <blockquote className="flex-1 text-[14.5px] leading-relaxed text-ink-900">&ldquo;{quote}&rdquo;</blockquote>
      <figcaption className="mt-5 border-t border-feint pt-4">
        <span className="block text-[13.5px] font-semibold text-ink-900">{name}</span>
        <span className="block text-[12.5px] text-graphite-600">{role}</span>
      </figcaption>
    </figure>
  );
}

/**
 * A slot for a real quote that has not been collected yet. Shown plainly
 * rather than invented, so the page never states a claim on someone's behalf
 * without their words.
 */
function TestimonialPending({ role }: { role: string }) {
  return (
    <figure className="flex h-full flex-col justify-between rounded-xl border border-dashed border-border-strong bg-surface p-6">
      <p className="text-[13.5px] italic leading-relaxed text-graphite-500">Quote pending. This card is reserved for feedback from someone at {role.split(',').pop()?.trim() || role} once it is collected.</p>
      <figcaption className="mt-5 border-t border-feint pt-4">
        <span className="block text-[12.5px] text-graphite-500">{role}</span>
      </figcaption>
    </figure>
  );
}

/** A stylised rendition of the Home dashboard, drawn, not a screenshot: it never goes stale as the real page changes. */
function HeroLedgerPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg" aria-hidden="true">
      <div className="flex items-center justify-between border-b border-feint-strong px-4 py-3">
        <span className="ll-printed text-[10px] text-graphite-600">Home</span>
        <span className="ll-printed text-[10px] text-graphite-500">Figures in KES</span>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-border bg-surface-2 p-4">
        {[
          ['CASH', '1,931,250'],
          ['OWED TO YOU', '540,000'],
          ['YOU OWE', '800,000'],
          ['NET PROFIT', '283,500'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface px-4 py-3.5">
            <p className="text-[10px] font-medium text-text-3">{label}</p>
            <p className="mt-1 font-display text-[19px] font-bold tabular-nums text-text">{value}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2.5 p-4">
        {[
          ['Electricity and water', '46,500'],
          ['Rent, second quarter', '180,000'],
          ['Customer receipts against March invoices', '1,200,000'],
        ].map(([memo, value]) => (
          <div key={memo} className="flex items-center justify-between gap-3 border-b border-feint pb-2.5 text-[12px]">
            <span className="min-w-0 truncate text-graphite-600">{memo}</span>
            <span className="shrink-0 font-medium text-ink-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The four-step setup flow: even boxes left to right on a time line, since
 * order is the entire point.
 */
function SetupFlowDiagram() {
  return (
    <div>
      <svg viewBox="0 0 760 190" role="img" aria-label="Four steps from creating an account to a posted entry" className="w-full" fontSize="13">
        <defs>
          <marker id="setup-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--feint-strong)" />
          </marker>
        </defs>
        <line x1="24" y1="24" x2="736" y2="24" stroke="var(--feint-strong)" strokeWidth="1.25" markerEnd="url(#setup-arrow)" />
        {SETUP_STEPS.map((step, index) => {
          const x = 24 + index * 178;
          const cx = x + 79;
          return (
            <g key={step.title}>
              <circle cx={cx} cy="24" r="5.5" fill="var(--paper-sheet)" stroke="var(--oxblood)" strokeWidth="1.5" />
              <text x={cx} y="28" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--oxblood)">{index + 1}</text>
              <rect x={x} y="52" width="158" height="118" fill="none" stroke="var(--feint-strong)" strokeWidth="1.25" />
              <text x={x + 14} y="78" fontSize="14" fontWeight="600" fill="var(--ink)">{step.title}</text>
              {wrapLines(step.body, 20).map((line, lineIndex) => (
                <text key={lineIndex} x={x + 14} y={102 + lineIndex * 17} fontSize="11.5" fill="var(--graphite-600)">{line}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A record's path from the screen to the ledger: a straight left-to-right flow with one shared destination. */
function PostingFlowDiagram() {
  const sources = ['Invoice', 'Bill', 'Bank match', 'Payroll run'];
  return (
    <svg viewBox="0 0 760 260" role="img" aria-label="An invoice, bill, bank match or payroll run all post through one service to the ledger" className="w-full" fontSize="13">
      <defs>
        <marker id="post-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--feint-strong)" />
        </marker>
      </defs>
      {sources.map((label, index) => {
        const y = 24 + index * 56;
        return (
          <g key={label}>
            <rect x="24" y={y} width="150" height="40" fill="none" stroke="var(--feint-strong)" strokeWidth="1.25" />
            <text x="99" y={y + 25} textAnchor="middle" fontSize="13" fill="var(--ink)">{label}</text>
            <path d={`M174 ${y + 20} V132 H300`} fill="none" stroke="var(--feint-strong)" strokeWidth="1.25" markerEnd="url(#post-arrow)" />
          </g>
        );
      })}
      <rect x="300" y="112" width="180" height="40" fill="var(--oxblood-tint)" stroke="var(--oxblood)" strokeWidth="1.5" />
      <text x="390" y="137" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--oxblood)">Posting service</text>
      <path d="M480 132 H590" fill="none" stroke="var(--feint-strong)" strokeWidth="1.25" markerEnd="url(#post-arrow)" />
      <rect x="590" y="92" width="146" height="80" fill="none" stroke="var(--feint-strong)" strokeWidth="1.25" />
      <text x="663" y="120" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">The ledger</text>
      <text x="663" y="140" textAnchor="middle" fontSize="11" fill="var(--graphite-600)">Debits equal</text>
      <text x="663" y="155" textAnchor="middle" fontSize="11" fill="var(--graphite-600)">credits, always</text>
    </svg>
  );
}

/** A plain word-wrap for SVG text, which does not wrap on its own. */
function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
