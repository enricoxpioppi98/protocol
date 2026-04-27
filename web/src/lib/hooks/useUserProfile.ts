'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { UserProfile } from '@/lib/types/models';

/**
 * Loads the current user's `user_profile` row once. The row is auto-created
 * empty by the `handle_new_user` Postgres trigger at signup, so it always
 * exists for an authenticated user — but its fields may be empty until the
 * user completes onboarding.
 *
 * `isOnboarded` is true once `goals.primary` is a non-empty string. That's
 * the minimum signal Claude needs to produce a tailored briefing.
 */
export function useUserProfile() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .maybeSingle();
    if (!error) {
      setProfile((data as UserProfile | null) ?? null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const isOnboarded = Boolean(
    profile?.goals && typeof profile.goals.primary === 'string' && profile.goals.primary.trim().length > 0
  );

  return { profile, loading, isOnboarded, refetch: fetchProfile };
}
