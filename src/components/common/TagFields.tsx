import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { Field } from '../ledger/Dialog';

export interface Tags {
  classId: string;
  locationId: string;
  /** A church's fund (Kundi); blank posts to the general fund. */
  fundId?: string;
}

export const NO_TAGS: Tags = { classId: '', locationId: '', fundId: '' };

/** The request headers that tag what a posting request posts (checked by the database). */
export function tagHeaders(tags: Tags | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (tags?.classId) headers['x-ledger-class'] = tags.classId;
  if (tags?.locationId) headers['x-ledger-location'] = tags.locationId;
  if (tags?.fundId) headers['x-ledger-fund'] = tags.fundId;
  return headers;
}

/** The organization's classes and locations, shared by every form and report. */
export function useTrackingCategories() {
  const { currentOrgId } = useAppStore();
  return useQuery({
    queryKey: ['tracking-categories', currentOrgId],
    queryFn: () => apiRequest<{ categories: Array<{ id: string; kind: 'CLASS' | 'LOCATION'; name: string; isActive: boolean }> }>('/api/tracking-categories'),
    staleTime: 60_000,
  });
}

/** A church's open funds, for the fund picker on its posting forms. */
export function useChurchFunds() {
  const { currentOrgId, activeCompany } = useAppStore();
  return useQuery({
    queryKey: ['funds', currentOrgId],
    enabled: activeCompany?.edition === 'church',
    queryFn: () => apiRequest<{ funds: Array<{ id: string; code: string; name: string; restricted: boolean; is_active: boolean }> }>('/api/funds'),
    staleTime: 60_000,
  });
}

/**
 * Class, location and (in a church) fund pickers for a posting form. Class
 * and location show only when the organization keeps that list (Settings,
 * Classes and locations), so nothing changes for one that does not.
 */
export function TagFields({ value, onChange }: { value: Tags; onChange: (tags: Tags) => void }) {
  const { activeCompany } = useAppStore();
  const categories = useTrackingCategories();
  const funds = useChurchFunds();
  const all = categories.data?.categories || [];
  const classes = all.filter((c) => c.kind === 'CLASS' && (c.isActive || c.id === value.classId));
  const locations = all.filter((c) => c.kind === 'LOCATION' && (c.isActive || c.id === value.locationId));
  const openFunds = activeCompany?.edition === 'church' ? (funds.data?.funds || []).filter((fund) => fund.is_active) : [];
  if (classes.length === 0 && locations.length === 0 && openFunds.length === 0) return null;
  return (
    <>
      {openFunds.length > 0 && (
        <Field label="Fund" hint="Income and costs on this posting belong to this fund.">
          <select name="fundId" value={value.fundId || ''} onChange={(e) => onChange({ ...value, fundId: e.target.value })}>
            <option value="">General fund</option>
            {openFunds.filter((fund) => fund.code !== 'GENERAL').map((fund) => (
              <option key={fund.id} value={fund.id}>{fund.name}{fund.restricted ? ' (restricted)' : ''}</option>
            ))}
          </select>
        </Field>
      )}
      {classes.length > 0 && (
        <Field label="Class" hint="Optional">
          <select name="classId" value={value.classId} onChange={(e) => onChange({ ...value, classId: e.target.value })}>
            <option value="">No class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {locations.length > 0 && (
        <Field label="Location" hint="Optional">
          <select name="locationId" value={value.locationId} onChange={(e) => onChange({ ...value, locationId: e.target.value })}>
            <option value="">No location</option>
            {locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}
