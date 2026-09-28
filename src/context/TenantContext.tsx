import { createContext, useContext, ReactNode } from 'react';
import { useAppStore } from '../store';

interface TenantContextType {
  orgId: string;
}

// Empty, not a fake-looking id: a consumer used outside TenantProvider must
// fail visibly (an empty x-org-id header, rejected by the Worker) rather than
// silently querying a tenant that was never real.
const TenantContext = createContext<TenantContextType>({ orgId: '' });

export function TenantProvider({ children }: { children: ReactNode }) {
  const { currentOrgId } = useAppStore();
  return (
    <TenantContext.Provider value={{ orgId: currentOrgId }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
