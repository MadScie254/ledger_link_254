import { createContext, useContext, ReactNode } from 'react';
import { useAppStore } from '../store';

interface TenantContextType {
  orgId: string;
}

// No default tenant. A consumer that reads an empty orgId is outside TenantProvider,
// or the user has no organization yet — both route to onboarding, never to a fake org.
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
