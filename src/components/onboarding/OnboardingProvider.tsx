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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  Check,
  CircleCheckBig,
  Contact,
  FilePlus2,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LoaderCircle,
  MessageSquareText,
  PanelLeft,
  Percent,
  Plug,
  ReceiptText,
  Scale,
  ScrollText,
  Search,
  Settings2,
  SkipForward,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthProvider';
import { useAppStore } from '../../store';
import type { OnboardingState, OnboardingStatus } from '../../server/onboarding';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import { CHAPTERS, TOUR_STEPS, type Language, type TourIcon } from './tourSteps';

const ICONS: Record<TourIcon, LucideIcon> = {
  book: BookOpen,
  sidebar: PanelLeft,
  search: Search,
  bell: Bell,
  dashboard: LayoutDashboard,
  bank: Landmark,
  invoice: FilePlus2,
  customers: Contact,
  bills: ReceiptText,
  accounting: Scale,
  reports: ChartNoAxesCombined,
  tax: Percent,
  payroll: Wallet,
  inventory: Boxes,
  projects: FolderKanban,
  feed: MessageSquareText,
  team: Users,
  plug: Plug,
  audit: ScrollText,
  settings: Settings2,
  help: LifeBuoy,
  done: CircleCheckBig,
};

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** After this long without finding a step's target, show the explanation without a spotlight. */
const MISSING_AFTER_MS = 6000;
const FALLBACK_CARD_HEIGHT = 420;
/** Below this, a phone sheet is too short to read, so it may overlap the target instead. */
const MIN_SHEET_HEIGHT = 260;

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

/**
 * Several elements can share one anchor (the phone tab bar and the desktop
 * sidebar are both "sidebar-index"). Take the first one that is on screen.
 */
function findVisible(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return element;
  }
  return null;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [persistenceProblem, setPersistenceProblem] = useState('');
  const [appReady, setAppReady] = useState(false);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  const userId = session?.user.id;

  const query = useQuery({
    queryKey: ['onboarding', userId],
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
    // The sync effect above re-copies query.data whenever the auth session object
    // changes (token refresh, tab refocus). Keep the cache current so that copy
    // can never roll a finished or in-progress tour back to NOT_ASKED.
    queryClient.setQueryData(['onboarding', userId], next);
    persist(next);
  }, [persist, queryClient, userId]);

  const restartTutorial = useCallback(() => {
    setActiveView('Home / Dashboard');
    update('IN_PROGRESS', 0);
  }, [setActiveView, update]);

  const handleStep = useCallback((step: number) => update('IN_PROGRESS', step), [update]);
  const handleSkip = useCallback(() => update('SKIPPED', state?.step || 0), [state?.step, update]);
  const handleComplete = useCallback(() => update('COMPLETED', TOUR_STEPS.length - 1), [update]);

  // A freshly authenticated account may still be on the required company
  // setup page. Keep NOT_ASKED intact until real app screens and their tour
  // targets exist; starting sooner would create a tour of missing elements.
  const canTour = appReady && Boolean(activeCompany);
  const value = useMemo(
    () => ({ restartTutorial, isReady: Boolean(state) && Boolean(activeCompany) }),
    [activeCompany, restartTutorial, state],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {canTour && state?.status === 'NOT_ASKED' && (
        <WelcomeDialog
          language={language}
          onLanguageChange={setLanguage}
          onStart={restartTutorial}
          onSkip={() => update('SKIPPED', 0)}
        />
      )}
      {canTour && state?.status === 'IN_PROGRESS' && (
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
        ? 'Is this your first time here? We’ll walk through every page in about 6 minutes, in plain words.'
        : 'Je, hii ni mara yako ya kwanza hapa? Tutapitia kila ukurasa kwa takribani dakika 6, kwa maneno rahisi.'}
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
          ? 'No accounting experience needed. The tour uses your real screens but will not create, edit, or remove any records. You can stop at any point and continue later.'
          : 'Huhitaji uzoefu wa uhasibu. Mafunzo yatatumia kurasa zako halisi bila kuunda, kubadilisha au kufuta rekodi yoyote. Unaweza kuacha wakati wowote na kuendelea baadaye.'}
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
  // Held in state, not a ref: the card is swapped out by AnimatePresence, and the
  // effects below must re-run when the new card element mounts.
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [isLocating, setIsLocating] = useState(Boolean(current.target));
  const [missing, setMissing] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const StepIcon = ICONS[current.icon];
  const en = language === 'en';

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

  // Find the step's target on whichever page it opens. A target that never
  // appears (a failed load, a hidden section) must not cost the person the
  // explanation, so the step is shown without a spotlight instead of skipped.
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    let timer = 0;
    let settleTimer = 0;
    let stopped = false;
    let stopTracking: (() => void) | undefined;
    const started = Date.now();
    setTargetRect(null);
    setMissing(false);
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
      setMissing(false);
      setIsLocating(false);
    };

    const track = (element: HTMLElement) => {
      // On a phone the card is a sheet over the lower part of the screen, so
      // bring the target to the top, just under the sticky header.
      const phone = window.innerWidth < 640;
      if (phone) element.style.scrollMarginTop = '72px';
      element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: phone ? 'start' : 'center', inline: 'nearest' });
      settleTimer = window.setTimeout(() => measure(element), reducedMotion ? 0 : 280);
      observer = new ResizeObserver(() => measure(element));
      observer.observe(element);
      const remeasure = () => measure(element);
      window.addEventListener('resize', remeasure);
      window.addEventListener('scroll', remeasure, true);
      stopTracking = () => {
        window.removeEventListener('resize', remeasure);
        window.removeEventListener('scroll', remeasure, true);
        if (phone) element.style.scrollMarginTop = '';
      };
    };

    const locate = () => {
      if (stopped) return;
      const element = findVisible(current.target!);
      if (element) {
        track(element);
        return;
      }
      const waited = Date.now() - started;
      if (waited >= MISSING_AFTER_MS) {
        setMissing(true);
        setIsLocating(false);
      }
      // Keep looking: a slow page may still arrive, and the spotlight then snaps to it.
      timer = window.setTimeout(locate, waited >= MISSING_AFTER_MS ? 400 : 100);
    };
    timer = window.setTimeout(locate, 60);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
      stopTracking?.();
    };
  }, [current.target, reducedMotion, step]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Place the card by the height its content wants, not the height it is
  // currently squeezed to, so a tall card can choose the side with room for it.
  useEffect(() => {
    if (!card) return;
    const measure = () => setNaturalHeight(Array.from(card.children).reduce((total, child) => total + (child as HTMLElement).scrollHeight, 0) + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [card, step, confirmSkip, isLocating, missing, language]);

  useEffect(() => {
    if (!card) return;
    // Land on Next, so Enter does what it says.
    const first = card.querySelector<HTMLElement>('[data-tour-primary]') || card.querySelector<HTMLElement>(FOCUSABLE);
    (first || card).focus();
  }, [card, step, confirmSkip, isLocating]);

  useEffect(() => {
    if (!card) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmSkip((open) => !open);
        return;
      }
      // Enter belongs to a focused button. Only treat it as Next from the card itself.
      const onControl = event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]');
      if (!confirmSkip && !event.repeat) {
        if (event.key === 'ArrowRight' || (event.key === 'Enter' && !onControl)) {
          event.preventDefault();
          goNext();
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goBack();
          return;
        }
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
  }, [card, confirmSkip, goBack, goNext, step]);

  // A phone sheet sits at the bottom unless the target lives down there (the tab bar).
  const sheetAtTop = isMobile && targetRect !== null && targetRect.top > window.innerHeight / 2;
  const placement = getCardPlacement(targetRect, naturalHeight || FALLBACK_CARD_HEIGHT);
  // A tall target (the Home figures) would run under a full-height sheet, so
  // the sheet takes only the room left below it and scrolls inside.
  const roomBelowTarget = targetRect ? window.innerHeight - (targetRect.top + targetRect.height) - 8 : Infinity;
  const sheetStyle = isMobile && !sheetAtTop && roomBelowTarget >= MIN_SHEET_HEIGHT && roomBelowTarget < window.innerHeight * 0.62
    ? { maxHeight: roomBelowTarget }
    : undefined;
  const chapterName = CHAPTERS[current.chapter][language];
  const stepLabel = en ? `Step ${step + 1} of ${TOUR_STEPS.length}` : `Hatua ${step + 1} kati ya ${TOUR_STEPS.length}`;

  const cardClass = isMobile
    ? `fixed inset-x-0 z-[92] flex max-h-[62vh] w-full flex-col overflow-hidden border border-feint-strong bg-paper-100 ll-lift focus:outline-none ${sheetAtTop ? 'top-0 border-t-0' : 'bottom-0 border-b-0'} border-x-0`
    : 'fixed z-[92] flex max-h-[calc(100vh-2rem)] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden border border-feint-strong bg-paper-100 ll-lift focus:outline-none';

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
          ref={setCard}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0, scale: 0.97 }}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeOut' }}
          className={cardClass}
          style={isMobile ? sheetStyle : placement}
        >
          {confirmSkip ? (
            <div className="p-5">
              <div className="border border-feint-strong bg-paper-200 p-2.5 text-oxblood w-fit" aria-hidden="true">
                <SkipForward className="h-5 w-5" />
              </div>
              <h2 id={titleId} className="ll-heading mt-4 text-[21px] text-ink-900">
                {en ? 'Skip the rest of the tour?' : 'Uruke mafunzo yaliyobaki?'}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">
                {en
                  ? 'Progress will be saved as skipped. You can start again from Settings at any time.'
                  : 'Hali itahifadhiwa kuwa umeruka. Unaweza kuanza tena kupitia Settings wakati wowote.'}
              </p>
              <div className="mt-5 flex justify-end gap-2 border-t border-feint pt-3">
                <button type="button" data-tour-primary onClick={() => setConfirmSkip(false)} className={buttonClass.secondary}>
                  {en ? 'Continue tour' : 'Endelea na mafunzo'}
                </button>
                <button type="button" onClick={onSkip} className={buttonClass.primary}>
                  {en ? 'Skip tour' : 'Ruka mafunzo'}
                </button>
              </div>
            </div>
          ) : isLocating ? (
            <div className="flex min-h-32 items-center gap-3 p-5" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin text-oxblood" aria-hidden="true" />
              <p id={titleId} className="text-[13.5px] text-graphite-600">
                {en ? 'Opening the next page…' : 'Inafungua ukurasa unaofuata…'}
              </p>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="border border-feint-strong bg-paper-200 p-2.5 text-oxblood" aria-hidden="true">
                    <StepIcon className="h-5 w-5" />
                  </div>
                  <LanguageSwitch language={language} onChange={onLanguageChange} />
                </div>
                <p className="ll-printed mt-4 text-[10.5px] text-graphite-600">{chapterName}</p>
                <h2 id={titleId} className="ll-heading mt-1 text-[21px] leading-tight text-ink-900">{current.title[language]}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-graphite-600">{current.body[language]}</p>

                {current.path && (
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-900">
                    <span className="ll-printed text-[10.5px] text-graphite-600">{en ? 'Find it in' : 'Ipo wapi'}</span>
                    <span className="font-semibold">{current.path}</span>
                  </p>
                )}

                {missing && (
                  <p role="status" className="mt-3 border border-feint-strong bg-paper-200 px-3 py-2 text-[12.5px] leading-snug text-ink-900">
                    {en
                      ? 'This part is not on screen right now, so it is not highlighted. The description above still applies.'
                      : 'Sehemu hii haionekani kwenye skrini kwa sasa, kwa hiyo haijaangaziwa. Maelezo yaliyo juu bado yanatumika.'}
                  </p>
                )}

                {current.points && (
                  <dl className="mt-3 border-t border-feint-strong">
                    {current.points.map((point) => {
                      const numbered = /^\d+$/.test(point.term.en);
                      return (
                        <div
                          key={point.term.en}
                          className={`border-b border-feint py-2 ${numbered ? 'grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2' : ''}`}
                        >
                          <dt className="text-[13px] font-semibold text-ink-900">{point.term[language]}</dt>
                          <dd className={`text-[13px] leading-snug text-graphite-600 ${numbered ? '' : 'mt-0.5'}`}>{point.text[language]}</dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </div>

              <div className="shrink-0 border-t border-feint bg-paper-100 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
                <div aria-label={stepLabel}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="ll-printed text-[10.5px] text-graphite-600">{stepLabel}</span>
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

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setConfirmSkip(true)} className={`${buttonClass.quiet} mr-auto`}>
                    {en ? 'Skip tour' : 'Ruka mafunzo'}
                  </button>
                  {step > 0 && (
                    <button type="button" onClick={goBack} className={buttonClass.secondary}>
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {en ? 'Back' : 'Rudi'}
                    </button>
                  )}
                  <button type="button" data-tour-primary onClick={goNext} className={buttonClass.primary}>
                    {step === TOUR_STEPS.length - 1 ? (
                      <><Check className="h-4 w-4" aria-hidden="true" /> {en ? 'Get started' : 'Anza kutumia'}</>
                    ) : (
                      <>{en ? 'Next' : 'Endelea'} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                    )}
                  </button>
                </div>
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

interface Placement {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * Put the card where it never covers what it is describing. Try beside the
 * target, then below, then above, and take the first side with room for the
 * whole card. If none has, use the roomiest side and let the text scroll inside
 * the card (the buttons stay pinned). Only a target that fills the screen gets
 * a centred card over it.
 */
function getCardPlacement(rect: Rect | null, naturalHeight: number): Placement {
  const margin = 16;
  const gap = 16;
  const minUseful = 220;
  const width = Math.min(368, window.innerWidth - margin * 2);
  const viewportRoom = window.innerHeight - margin * 2;
  const natural = Math.min(naturalHeight, viewportRoom);
  const centred = (): Placement => ({
    top: Math.max(margin, (window.innerHeight - natural) / 2),
    left: Math.max(margin, (window.innerWidth - width) / 2),
    maxHeight: viewportRoom,
  });
  if (!rect) return centred();

  const clampX = (x: number) => Math.min(Math.max(x, margin), window.innerWidth - width - margin);
  const clampY = (y: number, height: number) => Math.min(Math.max(y, margin), window.innerHeight - margin - height);
  const options = [
    { fits: rect.left + rect.width + gap + width <= window.innerWidth - margin, room: viewportRoom, at: (h: number) => ({ top: clampY(rect.top, h), left: rect.left + rect.width + gap }) },
    { fits: rect.left - gap - width >= margin, room: viewportRoom, at: (h: number) => ({ top: clampY(rect.top, h), left: rect.left - gap - width }) },
    { fits: true, room: window.innerHeight - margin - (rect.top + rect.height + gap), at: () => ({ top: rect.top + rect.height + gap, left: clampX(rect.left) }) },
    { fits: true, room: rect.top - gap - margin, at: (h: number) => ({ top: rect.top - gap - h, left: clampX(rect.left) }) },
  ].filter((option) => option.fits);

  const best = options.find((option) => option.room >= natural)
    || options.filter((option) => option.room >= minUseful).sort((a, b) => b.room - a.room)[0];
  if (!best) return centred();

  const height = Math.min(natural, best.room);
  return { ...best.at(height), maxHeight: height };
}
