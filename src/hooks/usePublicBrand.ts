import { useQuery } from '@tanstack/react-query';
import { editionDefinition, type Edition } from '../utils/editions';
import type { PublicBrand } from '../utils/publicBrand';

const business = editionDefinition('business');
export const BUSINESS_BRAND: PublicBrand = {
  edition: 'business', brandName: business.brandName, poweredBy: business.poweredBy,
};

export function usePublicBrand() {
  return useQuery({
    queryKey: ['public-brand'],
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<PublicBrand> => {
      const response = await fetch('/api/public/brand');
      if (!response.ok) throw new Error('Could not identify this site.');
      const body: unknown = await response.json();
      const edition = (body as { edition?: Edition } | null)?.edition;
      if (edition !== 'business' && edition !== 'law' && edition !== 'church') {
        throw new Error('This site returned an unknown edition.');
      }
      const definition = editionDefinition(edition);
      return { edition, brandName: definition.brandName, poweredBy: definition.poweredBy };
    },
  });
}
