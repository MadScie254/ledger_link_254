import { createContext, useContext, ReactNode } from 'react';
import { useAppStore } from '../store';

interface TenantContextType {
  orgId: string;
}

const TenantContext = createContext<TenantContextType>({ orgId: 'default-org-id' });

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
