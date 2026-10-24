import { getSupabase } from './supabase';
import { UserError } from './errors';
import { newToken } from './daraja';

export interface GivingPage {
  church: string;
  currency: string;
  paybill: string | null;
  ways: Array<{ fund: string; fundCode: string; kind: 'EXACT' | 'PREFIX' | 'MEMBER_NUMBER'; accountNumber: string | null }>;
  campaigns: Array<{ name: string; fund: string; goalCents: number; givenCents: number; startsOn: string; endsOn: string | null; accountNumber: string | null }>;
}

export const givingPageUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, '')}/give/${token}`;

/**
 * A Kundi church's public giving page (public.church_giving_links): the
 * paybill, the account number for each fund and the open campaigns. It
 * names no member and shows no gift.
 */
export class GivingPageService {
  static async share(orgId: string, actor: string, origin: string) {
    const { data, error } = await getSupabase().rpc('share_giving_page', { p_org_id: orgId, p_token: newToken(), p_actor: actor });
    if (error) throw error;
    const link = data as { token: string; createdAt: string; views: number; created: boolean };
    return { url: givingPageUrl(origin, link.token), createdAt: link.createdAt, views: Number(link.views), created: link.created };
  }

  static async withdraw(orgId: string, actor: string) {
    const { data, error } = await getSupabase().rpc('withdraw_giving_page', { p_org_id: orgId, p_actor: actor });
    if (error) throw error;
    return { withdrawn: Boolean(data) };
  }

  static async view(token: string): Promise<GivingPage> {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new UserError('This giving page link is not valid.', 400);
    const { data, error } = await getSupabase().rpc('open_giving_page', { p_token: token });
    if (error) throw error;
    if (!data) throw new UserError('This giving page is not available any more. Ask the church for its current link.', 404);
    const page = data as any;
    return {
      church: page.church, currency: page.currency, paybill: page.paybill ?? null, ways: page.ways ?? [],
      campaigns: (page.campaigns ?? []).map((campaign: any) => ({
        ...campaign, goalCents: Number(campaign.goalCents), givenCents: Number(campaign.givenCents),
      })),
    };
  }
}
