import { useEffect, useState } from 'react';

/**
 * Mobile data is the default connection for this product's audience
 * (PRODUCT.md, Operating Context). A dropped connection should say so in the
 * app's own voice, not leave every screen failing silently one query at a time.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-40 border-b border-oxblood bg-oxblood px-3 py-1.5 text-center text-[12.5px] font-semibold text-white">
      Offline. Nothing can be saved until the connection returns; anything submitted now is not posted.
    </div>
  );
}
