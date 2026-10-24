import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';
import { installAuthenticatedApiFetch } from './utils/api.ts';

// Safely suppress benign Vite dev WebSocket reconnect warnings
if (typeof window !== 'undefined') {
  installAuthenticatedApiFetch();
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message || String(event.reason || '');
    if (msg.includes('WebSocket') || msg.includes('websocket')) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

const root = createRoot(document.getElementById('root')!);

// Development-only design preview of signed-in screens with sample books.
// Gated on MODE, not DEV: DEV follows NODE_ENV, and a NODE_ENV=development in
// .env turns DEV true inside `vite build`. MODE is "production" for every build,
// so this branch and the harness module are removed from the bundle.
const payLink = /^\/pay\/([0-9a-f]{64})\/?$/.exec(window.location.pathname);
if (payLink) {
  // A customer opening a shared invoice: no sign-in, no app shell.
  void import('./components/public/PublicInvoicePage').then(({ PublicInvoicePage }) => {
    root.render(<StrictMode><PublicInvoicePage token={payLink[1]} /></StrictMode>);
  });
} else if (/^\/give\/[0-9a-f]{64}\/?$/.test(window.location.pathname)) {
  // A church's giving page, shared with the congregation.
  const token = window.location.pathname.split('/')[2];
  void import('./components/public/PublicGivingPage').then(({ PublicGivingPage }) => {
    root.render(<StrictMode><PublicGivingPage token={token} /></StrictMode>);
  });
} else if (import.meta.env.MODE === 'development' && window.location.pathname.startsWith('/__preview')) {
  void import('./dev/PreviewHarness').then(({ mountPreview }) => mountPreview(root));
} else {
  const queryClient = new QueryClient();
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
