import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { Field } from '../ledger/Dialog';

export interface Tags {
  classId: string;
  locationId: string;
}

export const NO_TAGS: Tags = { classId: '', locationId: '' };

/** The request headers that tag what a posting request posts (checked by the database). */
export function tagHeaders(tags: Tags | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (tags?.classId) headers['x-ledger-class'] = tags.classId;
  if (tags?.locationId) headers['x-ledger-location'] = tags.locationId;
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

/**
 * Class and location pickers for a posting form. Each shows only when the
 * organization keeps that list (Settings, Classes and locations), so
 * nothing changes for one that does not.
 */
export function TagFields({ value, onChange }: { value: Tags; onChange: (tags: Tags) => void }) {
  const categories = useTrackingCategories();
  const all = categories.data?.categories || [];
  const classes = all.filter((c) => c.kind === 'CLASS' && (c.isActive || c.id === value.classId));
  const locations = all.filter((c) => c.kind === 'LOCATION' && (c.isActive || c.id === value.locationId));
  if (classes.length === 0 && locations.length === 0) return null;
  return (
    <>
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
