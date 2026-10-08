import { editionDefinition, type Edition } from './editions.ts';

export interface PublicBrand { edition: Edition; brandName: string; poweredBy: boolean }
export interface BrandHostLists { law: string[]; church: string[] }

/** Accept only a hostname and optional port, never a URL, path or user info. */
function normalizeHost(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(raw) || raw.includes('..')) return null;
  try {
    const parsed = new URL(`https://${raw}`);
    return parsed.hostname && parsed.port !== '0' ? parsed.host : null;
  } catch {
    return null;
  }
}

export function configuredBrandHosts(law: string | undefined, church: string | undefined): BrandHostLists {
  const parse = (value: string | undefined) => [...new Set((value || '').split(',')
    .map((entry) => normalizeHost(entry)).filter((entry): entry is string => Boolean(entry)))];
  return { law: parse(law), church: parse(church) };
}

/** The URL and Host must agree, so a caller cannot select branding with a forged header. */
export function brandForHost(hostHeader: string | undefined, requestUrl: string, hosts: BrandHostLists): PublicBrand {
  let requestHost: string | null;
  try { requestHost = normalizeHost(new URL(requestUrl).host); }
  catch { requestHost = null; }
  const suppliedHost = hostHeader ? normalizeHost(hostHeader) : requestHost;
  const edition: Edition = !requestHost || suppliedHost !== requestHost ? 'business'
    : hosts.law.includes(requestHost) ? 'law'
      : hosts.church.includes(requestHost) ? 'church' : 'business';
  const definition = editionDefinition(edition);
  return { edition, brandName: definition.brandName, poweredBy: definition.poweredBy };
}

/** Keep exact existing origins, then accept each configured brand's HTTPS origin. */
export function allowedOriginsForBrands(existing: string, hosts: BrandHostLists): string[] {
  return [...new Set([
    ...existing.split(',').map((origin) => origin.trim()).filter(Boolean),
    ...[...hosts.law, ...hosts.church].map((host) => `https://${host}`),
  ])];
}
