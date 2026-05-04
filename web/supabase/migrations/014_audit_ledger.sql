-- Track 3 (v2): Audit ledger for sync orchestrator + brokered fetches.
-- Persists what stdout-only logAudit() used to drop on the floor, so the
-- sync dashboard (Track 4) can show real per-source freshness + recent
-- activity, and so we have a paper trail for debugging 429 / 5xx storms.

CREATE TABLE IF NOT EXISTS public.audit_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- nullable for system actions (cron)
  ts            timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL,                                     -- user_id string, or 'system' for cron
  action        text NOT NULL,                                     -- 'sync.garmin', 'sync.whoop', 'fetch.post', etc.
  target        text NOT NULL,                                     -- hostname or service id
  purpose       text NOT NULL,                                     -- 'biometrics_sync' | 'briefing' | 'chat' | ...
  status        text NOT NULL,                                     -- 'ok' | 'error' | 'retry' | 'skipped'
  ms_elapsed    integer,
  rows_affected integer,
  error_message text,
  payload       jsonb                                              -- request/response context (NO secrets)
);

CREATE INDEX IF NOT EXISTS audit_ledger_user_ts_idx
  ON public.audit_ledger(user_id, ts DESC);

CREATE INDEX IF NOT EXISTS audit_ledger_action_ts_idx
  ON public.audit_ledger(action, ts DESC);

ALTER TABLE public.audit_ledger ENABLE ROW LEVEL SECURITY;

-- Users can read their own audit rows. No INSERT/UPDATE/DELETE policy is
-- declared, so only the service-role client (which bypasses RLS) can write.
CREATE POLICY "Users can read own audit rows"
  ON public.audit_ledger
  FOR SELECT
  USING (auth.uid() = user_id);

-- Realtime so the sync dashboard (Track 4) can subscribe to new rows as
-- they land. supabase_realtime is the default publication used by 002.
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_ledger;
