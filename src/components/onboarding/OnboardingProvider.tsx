import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  CircleCheckBig,
  FilePlus2,
  Landmark,
  LayoutDashboard,
  LoaderCircle,
  Settings2,
  SkipForward,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthProvider';
import { useAppStore } from '../../store';
import type { OnboardingState, OnboardingStatus } from '../../server/onboarding';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

type Language = 'en' | 'sw';
type Copy = Record<Language, string>;

interface TourStep {
  title: Copy;
  body: Copy;
  view?: string;
  target?: string;
  icon: LucideIcon;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: { en: 'Welcome to your books', sw: 'Karibu kwenye vitabu vyako' },
    body: {
      en: 'Ledger Link keeps sales, bills, payments, and reports together for your business.',
      sw: 'Ledger Link huweka mauzo, bili, malipo na ripoti za biashara yako mahali pamoja.',
    },
    view: 'Home / Dashboard',
    target: '[data-tour="app-location"]',
    icon: BookOpen,
  },
  {
    title: { en: 'Start with the day’s position', sw: 'Anza na hali ya biashara leo' },
    body: {
      en: 'These figures show the cash you have, money customers owe, bills to pay, and the result for the period.',
      sw: 'Takwimu hizi zinaonyesha fedha ulizo nazo, madeni ya wateja, bili za kulipa na matokeo ya kipindi.',
    },
    view: 'Home / Dashboard',
    target: '[data-tour="dashboard-summary"]',
    icon: LayoutDashboard,
  },
  {
    title: { en: 'Record a sale with an invoice', sw: 'Rekodi mauzo kwa ankara' },
    body: {
      en: 'Create an invoice when a customer owes the business. Ledger Link records the sale in the books for you.',
      sw: 'Tengeneza ankara mteja anapodaiwa na biashara. Ledger Link hurekodi mauzo kwenye vitabu kwa niaba yako.',
    },
    view: 'Sales',
    target: '[data-tour="new-invoice"]',
    icon: FilePlus2,
  },
  {
    title: { en: 'Match money to the right record', sw: 'Linganisha fedha na rekodi sahihi' },
    body: {
      en: 'Banking brings in bank and M-Pesa lines. Matching a line to an invoice or bill explains what the money was for.',
      sw: 'Banking huleta miamala ya benki na M-Pesa. Kulinganisha muamala na ankara au bili huonyesha fedha ilikuwa ya nini.',
    },
    view: 'Banking',
    target: '[data-tour="banking-overview"]',
    icon: Landmark,
  },
  {
    title: { en: 'See the bigger picture', sw: 'Ona picha kamili ya biashara' },
    body: {
      en: 'Reports turn your records into clear statements about profit, cash, what the business owns, and what it owes.',
      sw: 'Ripoti hubadilisha rekodi zako kuwa taarifa wazi za faida, fedha, mali ya biashara na madeni yake.',
    },
    view: 'Reports',
    target: '[data-tour="reports-overview"]',
    icon: ChartNoAxesCombined,
  },
  {
    title: { en: 'Work with your team', sw: 'Fanya kazi na timu yako' },
    body: {
      en: 'Owners and admins can invite another person and choose what they may change in these books.',
      sw: 'Wamiliki na wasimamizi wanaweza kualika mtu mwingine na kuchagua anachoweza kubadilisha kwenye vitabu hivi.',
    },
    view: 'Team',
    target: '[data-tour="team-overview"]',
    icon: Users,
  },
  {
    title: { en: 'Help is always here', sw: 'Msaada unapatikana hapa kila wakati' },
    body: {
      en: 'Open Settings whenever you want to run this tutorial again. Restarting it never changes your business data.',
      sw: 'Fungua Settings wakati wowote unapotaka kuanza mafunzo haya tena. Kuanzisha upya hakubadilishi data ya biashara yako.',
    },
    view: 'Settings',
    target: '[data-tour="restart-tutorial"]',
    icon: Settings2,
  },
  {
    title: { en: 'The books are ready', sw: 'Vitabu viko tayari' },
    body: {
      en: 'Begin with a sale, a bill, or a bank line. Ledger Link will keep the reports connected to every record.',
      sw: 'Anza na mauzo, bili au muamala wa benki. Ledger Link itaunganisha kila rekodi na ripoti zako.',
    },
    icon: CircleCheckBig,
  },
];

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingContextValue {
  restartTutorial: () => void;
  isReady: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  restartTutorial: () => undefined,
  isReady: false,
});

export const useOnboarding = () => useContext(OnboardingContext);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [persistenceProblem, setPersistenceProblem] = useState('');
  const [appReady, setAppReady] = useState(false);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());

  const query = useQuery({
    queryKey: ['onboarding', session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const response = await fetch('/api/onboarding');
      if (!response.ok) throw new Error('Onboarding state could not be loaded.');
      return response.json() as Promise<OnboardingState>;
    },
    staleTime: Infinity,
    retry: 2,
  });

  useEffect(() => {
    if (query.data) setState(query.data);
    if (!session) {
      setState(null);
      setAppReady(false);
    }
  }, [query.data, session]);

  useEffect(() => {
    if (!session) return;
    const root = document.getElementById('root');
    if (!root) return;
    const check = () => setAppReady(Boolean(document.querySelector('[data-tour="app-location"]')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [session]);

  const persist = useCallback((next: OnboardingState) => {
    // Serialize writes so a fast sequence of Next actions can never let an
    // older request arrive last and move persisted progress backwards.
    persistQueue.current = persistQueue.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch('/api/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
          keepalive: true,
        });
        if (!response.ok) throw new Error('Progress could not be saved.');
        setPersistenceProblem('');
      })
      .catch(() => {
        setPersistenceProblem('Progress is not saved yet. Check the connection before closing this page.');
      });
  }, []);

  const update = useCallback((status: OnboardingStatus, step: number) => {
    const next = { status, step } satisfies OnboardingState;
    setState(next);
    persist(next);
  }, [persist]);

  const restartTutorial = useCallback(() => {
    setActiveView('Home / Dashboard');
    update('IN_PROGRESS', 0);
  }, [setActiveView, update]);

  const handleStep = useCallback((step: number) => update('IN_PROGRESS', step), [update]);
  const handleSkip = useCallback(() => update('SKIPPED', state?.step || 0), [state?.step, update]);
  const handleComplete = useCallback(() => update('COMPLETED', TOUR_STEPS.length - 1), [update]);

  const value = useMemo(() => ({ restartTutorial, isReady: Boolean(state) }), [restartTutorial, state]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {appReady && state?.status === 'NOT_ASKED' && (
        <WelcomeDialog
          language={language}
          onLanguageChange={setLanguage}
          onStart={restartTutorial}
          onSkip={() => update('SKIPPED', 0)}
        />
      )}
      {appReady && state?.status === 'IN_PROGRESS' && (
        <ProductTour
          step={Math.min(state.step, TOUR_STEPS.length - 1)}
          language={language}
          onLanguageChange={setLanguage}
          onStep={handleStep}
          onSkip={handleSkip}
          onComplete={handleComplete}
          persistenceProblem={persistenceProblem}
        />
      )}
    </OnboardingContext.Provider>
  );
}

function WelcomeDialog({
  language,
  onLanguageChange,
  onStart,
  onSkip,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onSkip}
      title={language === 'en' ? 'Welcome to Ledger Link' : 'Karibu Ledger Link'}
      note={language === 'en'
        ? 'Is this your first time here? We’ll walk through everything in about 3 minutes.'
        : 'Je, hii ni mara yako ya kwanza hapa? Tutakuonyesha kila kitu kwa takribani dakika 3.'}
      width="sm"
      showCloseButton={false}
      footer={(
        <>
          <button type="button" onClick={onSkip} className={buttonClass.secondary}>
            <SkipForward className="h-4 w-4" aria-hidden="true" />
            {language === 'en' ? 'I’ve used it before, skip this' : 'Nimewahi kuitumia, ruka hii'}
          </button>
          <button type="button" onClick={onStart} className={buttonClass.primary}>
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {language === 'en' ? 'Yes, show me around' : 'Ndiyo, nionyeshe'}
          </button>
        </>
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="border border-feint-strong bg-paper-200 p-3 text-oxblood" aria-hidden="true">
          <BookOpen className="h-7 w-7" />
        </div>
        <LanguageSwitch language={language} onChange={onLanguageChange} />
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-graphite-600">
        {language === 'en'
          ? 'The tour uses your real screens but will not create, edit, or remove any records.'
          : 'Mafunzo yatatumia kurasa zako halisi bila kuunda, kubadilisha au kufuta rekodi yoyote.'}
      </p>
    </Dialog>
  );
}

function ProductTour({
  step,
  language,
  onLanguageChange,
  onStep,
  onSkip,
  onComplete,
  persistenceProblem,
}: {
  step: number;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onStep: (step: number) => void;
  onSkip: () => void;
  onComplete: () => void;
  persistenceProblem: string;
}) {
  const current = TOUR_STEPS[step];
  const setActiveView = useAppStore((state) => state.setActiveView);
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [isLocating, setIsLocating] = useState(Boolean(current.target));
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

  const goNext = useCallback(() => {
    setConfirmSkip(false);
    if (step >= TOUR_STEPS.length - 1) onComplete();
    else onStep(step + 1);
  }, [onComplete, onStep, step]);

  const goBack = useCallback(() => {
    setConfirmSkip(false);
    if (step > 0) onStep(step - 1);
  }, [onStep, step]);

  useEffect(() => {
    if (current.view) setActiveView(current.view);
  }, [current.view, setActiveView]);

  useEffect(() => {
    const appRoot = document.getElementById('root');
    const returnFocus = document.activeElement as HTMLElement | null;
    const alreadyInert = appRoot?.hasAttribute('inert') || false;
    appRoot?.setAttribute('inert', '');
    return () => {
      if (!alreadyInert) appRoot?.removeAttribute('inert');
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  useEffect(() => {
    let observer: ResizeObserver | undefined;
    let timer = 0;
    let stopped = false;
    let trackedElement: HTMLElement | null = null;
    let remeasure: (() => void) | null = null;
    const started = Date.now();
    setTargetRect(null);
    setIsLocating(Boolean(current.target));

    if (!current.target) {
      setIsLocating(false);
      return;
    }

    const measure = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const padding = 8;
      setTargetRect({
        top: Math.max(4, rect.top - padding),
        left: Math.max(4, rect.left - padding),
        width: Math.min(window.innerWidth - 8, rect.width + padding * 2),
        height: Math.min(window.innerHeight - 8, rect.height + padding * 2),
      });
      setIsLocating(false);
    };

    const locate = () => {
      if (stopped) return;
      const element = document.querySelector<HTMLElement>(current.target!);
      if (element && element.getClientRects().length > 0) {
        trackedElement = element;
        element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
        window.setTimeout(() => measure(element), reducedMotion ? 0 : 280);
        observer = new ResizeObserver(() => measure(element));
        observer.observe(element);
        remeasure = () => measure(element);
        window.addEventListener('resize', remeasure);
        window.addEventListener('scroll', remeasure, true);
        return;
      }
      if (Date.now() - started >= 12000) {
        // Role-based and conditional UI may remove a target. Continue instead
        // of leaving the person with an empty spotlight.
        if (step < TOUR_STEPS.length - 1) onStep(step + 1);
        return;
      }
      timer = window.setTimeout(locate, 100);
    };
    timer = window.setTimeout(locate, 60);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      if (remeasure && trackedElement) {
        window.removeEventListener('resize', remeasure);
        window.removeEventListener('scroll', remeasure, true);
      }
    };
  }, [current.target, onStep, reducedMotion, step]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const first = card.querySelector<HTMLElement>(FOCUSABLE);
    (first || card).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmSkip(true);
        return;
      }
      if (!confirmSkip && (event.key === 'ArrowRight' || event.key === 'Enter')) {
        event.preventDefault();
        goNext();
        return;
      }
      if (!confirmSkip && event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const firstElement = focusables[0];
      const lastElement = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === firstElement || !card.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !card.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmSkip, goBack, goNext, step]);

  const position = getCardPosition(targetRect, isMobile);
  const StepIcon = current.icon;

  return createPortal(
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      <div className="absolute inset-0" aria-hidden="true" />
      {targetRect && (
        <motion.div
          className="pointer-events-none fixed border-2 border-[var(--oxblood)]"
          initial={false}
          animate={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }}
          transition={{ duration: reducedMotion ? 0 : 0.3, ease: 'easeInOut' }}
          style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.62), 0 0 22px color-mix(in srgb, var(--oxblood) 70%, transparent)' }}
        />
      )}
      {!targetRect && <div className="pointer-events-none fixed inset-0 bg-black/60" aria-hidden="true" />}

      <AnimatePresence mode="wait">
        <motion.div
          key={`${step}-${confirmSkip ? 'confirm' : 'step'}`}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0, scale: 0.97 }}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeOut' }}
          className={`fixed z-[92] border border-feint-strong bg-paper-100 ll-lift focus:outline-none ${isMobile ? 'inset-x-0 bottom-0 w-full border-x-0 border-b-0 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]' : 'w-[min(23rem,calc(100vw-2rem))] p-5'}`}
          style={isMobile ? undefined : position}
        >
          {confirmSkip ? (
            <>
              <div className="border border-feint-strong bg-paper-200 p-2.5 text-oxblood w-fit" aria-hidden="true">
                <SkipForward className="h-5 w-5" />
              </div>
              <h2 id={titleId} className="ll-heading mt-4 text-[21px] text-ink-900">
                {language === 'en' ? 'Skip the rest of the tour?' : 'Uruke mafunzo yaliyobaki?'}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">
                {language === 'en'
                  ? 'Progress will be saved as skipped. You can start again from Settings at any time.'
                  : 'Hali itahifadhiwa kuwa umeruka. Unaweza kuanza tena kupitia Settings wakati wowote.'}
              </p>
              <div className="mt-5 flex justify-end gap-2 border-t border-feint pt-3">
                <button type="button" onClick={() => setConfirmSkip(false)} className={buttonClass.secondary}>
                  {language === 'en' ? 'Continue tour' : 'Endelea na mafunzo'}
                </button>
                <button type="button" onClick={onSkip} className={buttonClass.primary}>
                  {language === 'en' ? 'Skip tour' : 'Ruka mafunzo'}
                </button>
              </div>
            </>
          ) : isLocating ? (
            <div className="flex min-h-32 items-center gap-3" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin text-oxblood" aria-hidden="true" />
              <p className="text-[13.5px] text-graphite-600">
                {language === 'en' ? 'Opening the next page…' : 'Inafungua ukurasa unaofuata…'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="border border-feint-strong bg-paper-200 p-2.5 text-oxblood" aria-hidden="true">
                  <StepIcon className="h-5 w-5" />
                </div>
                <LanguageSwitch language={language} onChange={onLanguageChange} />
              </div>
              <h2 id={titleId} className="ll-heading mt-4 text-[21px] leading-tight text-ink-900">{current.title[language]}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">{current.body[language]}</p>

              <div className="mt-5" aria-label={`${language === 'en' ? 'Step' : 'Hatua'} ${step + 1} ${language === 'en' ? 'of' : 'kati ya'} ${TOUR_STEPS.length}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="ll-printed text-[10.5px] text-graphite-600">
                    {language === 'en' ? `Step ${step + 1} of ${TOUR_STEPS.length}` : `Hatua ${step + 1} kati ya ${TOUR_STEPS.length}`}
                  </span>
                  <span className="text-[11.5px] text-graphite-500">{Math.round(((step + 1) / TOUR_STEPS.length) * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1 bg-paper-200">
                  <motion.div
                    className="h-full bg-oxblood-fill"
                    initial={false}
                    animate={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
                    transition={{ duration: reducedMotion ? 0 : 0.22 }}
                  />
                </div>
              </div>

              {persistenceProblem && <p role="alert" className="mt-3 text-[12px] text-ledger-red">{persistenceProblem}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-feint pt-3">
                <button type="button" onClick={() => setConfirmSkip(true)} className={`${buttonClass.quiet} mr-auto`}>
                  {language === 'en' ? 'Skip tour' : 'Ruka mafunzo'}
                </button>
                {step > 0 && (
                  <button type="button" onClick={goBack} className={buttonClass.secondary}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {language === 'en' ? 'Back' : 'Rudi'}
                  </button>
                )}
                <button type="button" onClick={goNext} className={buttonClass.primary}>
                  {step === TOUR_STEPS.length - 1 ? (
                    <><Check className="h-4 w-4" aria-hidden="true" /> {language === 'en' ? 'Get started' : 'Anza kutumia'}</>
                  ) : (
                    <>{language === 'en' ? 'Next' : 'Endelea'} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                  )}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function LanguageSwitch({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return (
    <div className="flex border border-feint-strong" role="group" aria-label="Tour language">
      {(['en', 'sw'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={language === value}
          className={`h-7 px-2 text-[11px] font-semibold ${language === value ? 'bg-oxblood-fill text-white' : 'bg-paper-100 text-graphite-600 hover:text-ink-900'}`}
        >
          {value === 'en' ? 'EN' : 'SW'}
        </button>
      ))}
    </div>
  );
}

function getCardPosition(rect: Rect | null, isMobile: boolean): { top: number; left: number } | undefined {
  if (isMobile) return undefined;
  const margin = 16;
  const gap = 16;
  const width = Math.min(368, window.innerWidth - margin * 2);
  const estimatedHeight = 390;

  if (!rect) {
    return {
      top: Math.max(margin, (window.innerHeight - estimatedHeight) / 2),
      left: Math.max(margin, (window.innerWidth - width) / 2),
    };
  }

  const right = rect.left + rect.width + gap;
  const left = rect.left - width - gap;
  const below = rect.top + rect.height + gap;
  const above = rect.top - estimatedHeight - gap;
  let top = Math.min(Math.max(rect.top, margin), window.innerHeight - estimatedHeight - margin);
  let horizontal = right;

  if (right + width > window.innerWidth - margin && left >= margin) horizontal = left;
  else if (right + width > window.innerWidth - margin) {
    horizontal = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
    if (below + estimatedHeight <= window.innerHeight - margin) top = below;
    else if (above >= margin) top = above;
  }

  return { top: Math.max(margin, top), left: Math.max(margin, horizontal) };
}
