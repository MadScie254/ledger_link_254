import { getSupabase } from './supabase';

export type OnboardingStatus = 'NOT_ASKED' | 'IN_PROGRESS' | 'SKIPPED' | 'COMPLETED';

export interface OnboardingState {
  status: OnboardingStatus;
  step: number;
}

export class OnboardingService {
  static async getState(userId: string): Promise<OnboardingState> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_profiles')
      .select('onboarding_status, onboarding_step')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      const { data: created, error: createError } = await supabase
        .from('user_profiles')
        .insert({ user_id: userId })
        .select('onboarding_status, onboarding_step')
        .single();
      if (createError) throw createError;
      return { status: created.onboarding_status, step: created.onboarding_step };
    }

    return { status: data.onboarding_status, step: data.onboarding_step };
  }

  static async updateState(userId: string, state: OnboardingState): Promise<OnboardingState> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          onboarding_status: state.status,
          onboarding_step: state.step,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('onboarding_status, onboarding_step')
      .single();

    if (error) throw error;
    return { status: data.onboarding_status, step: data.onboarding_step };
  }
}
