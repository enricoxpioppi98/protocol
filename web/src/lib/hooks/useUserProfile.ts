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

const DEFAULT_PINNED_METRICS: string[] = [
  'sleep_score',
  'hrv_ms',
  'resting_hr',
  'stress_avg',
];

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

  // The DB column has a default, but during the brief window before the
  // profile loads (or if a legacy row predates migration 007) we fall back
  // to the canonical 4-metric grid so the card never renders empty.
  const pinned: string[] = useMemo(() => {
    const fromProfile = profile?.pinned_metrics;
    if (Array.isArray(fromProfile) && fromProfile.length > 0) {
      return fromProfile;
    }
    return DEFAULT_PINNED_METRICS;
  }, [profile?.pinned_metrics]);

  const setPinned = useCallback(
    async (next: string[]) => {
      const res = await fetch('/api/profile/pinned-metrics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) {
        console.warn('[useUserProfile] failed to save pinned metrics', res.status);
        return;
      }
      await fetchProfile();
    },
    [fetchProfile]
  );

  return {
    profile,
    loading,
    isOnboarded,
    refetch: fetchProfile,
    pinned,
    setPinned,
  };
}
