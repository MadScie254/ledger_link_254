/**
 * A path router in fifty lines, rather than a routing dependency.
 *
 * The whole surface is six flat marketing paths plus one `/app` catch-all —
 * no nested routes, no route params, no data loaders. Cloudflare serves the
 * SPA with `not_found_handling: "single-page-application"`, so every path
 * returns index.html and the client takes it from there.
 */
import { useState, useEffect, type AnchorHTMLAttributes } from 'react';

/** Fired on pushState so `usePathname` re-reads; `popstate` covers back/forward. */
const LOCATION_CHANGED = 'll:locationchange';

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new Event(LOCATION_CHANGED));
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(LOCATION_CHANGED, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(LOCATION_CHANGED, sync);
    };
  }, []);

  return pathname;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/**
 * Renders a real anchor, so middle-click, ctrl-click and "copy link address"
 * all behave. Only a plain left click is intercepted.
 */
export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
        window.scrollTo(0, 0);
      }}
      {...rest}
    />
  );
}
