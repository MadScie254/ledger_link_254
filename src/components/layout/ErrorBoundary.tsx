import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buttonClass } from '../ledger/Page';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A page that throws while rendering must not blank the whole book. This
 * catches it, names what broke, and offers the one recovery a reader
 * understands without a manual: start this page over.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ledger Link: a page failed to render.', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="flex min-h-64 flex-col items-start gap-3 px-4 py-10 sm:px-8">
        <p className="ll-heading text-[19px] text-ink-900">This page could not be shown.</p>
        <p className="max-w-md text-[13.5px] leading-relaxed text-graphite-600">
          {this.state.error.message || 'Something in this page failed to render.'} The rest of the app, and everything already posted to the books, is unaffected.
        </p>
        <button type="button" onClick={() => this.setState({ error: null })} className={buttonClass.secondary}>
          Try this page again
        </button>
      </div>
    );
  }
}
