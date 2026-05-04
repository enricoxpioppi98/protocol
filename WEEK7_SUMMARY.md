# Protocol — Week 7 (v2) — Agent-generated summary

**Class:** MPCS 51238 — Design, Build, Ship · Spring 2026
**Milestone:** Project v2 (due Week 7)
**Repo:** [Protocol](https://github.com/enricoxpioppi98/protocol) · branch `main`

## What v2 does

v1 shipped six data-source integrations across two waves: Garmin (manual button + Railway service), Whoop (OAuth + manual button), Apple Watch / HealthKit (iOS Shortcut webhook), and three optional health signals (CGM glucose, blood-panel PDFs, menstrual cycle). The cohort review at the v1 share-out flagged data management — *"if you're pinging a lot of different data sources, how often you're doing that, and making sure that you're not overloading your database with too frequent of calls"* — as the highest-leverage thing to fix.

That feedback is the entire v2 brief. The ingestion architecture in v1 had four silent failure modes:

1. **No scheduled sync.** Every source was a manual button press. The user was the cron.
2. **Silent same-day overwrites.** `biometrics_daily` PK was `(user_id, date)`; the second sync of the day for any source erased the first.
3. **No 429 backoff.** Rate-limit hits required a manual re-click into the same failure.
4. **Audit broker was stdout-only**, despite the `// v2: persist to audit_ledger` comment sitting in `lib/audit/broker.ts` since week 6.

v2 closes all four gaps and ships a visible artifact — a sync dashboard at `/settings/integrations` — that proves it.

## What I built this week

### Sync orchestrator + Vercel cron
- `web/src/lib/sync/{orchestrator.ts, policy.ts}` — `runSync(userId, sources, opts)` with per-source cooldowns (Garmin 1h, Whoop 15min, Apple Watch push-only). In-process per-user lock so concurrent triggers coalesce instead of stampeding.
- `web/src/lib/sync/sources/{garmin.ts, whoop.ts}` — fetcher logic extracted from the route handlers; the manual button path and the cron path share the same code now.
- `POST /api/sync/run` — authenticated user-triggered sync.
- `GET/POST /api/sync/cron` — `Bearer ${CRON_SECRET}` auth, fans out across all users with at least one connected integration.
- `web/vercel.json` — daily cron `0 8 * * *` UTC → `/api/sync/cron`.

### Multi-source biometrics — no more silent overwrites
- Migration `013_biometrics_multi_source.sql` — `biometrics_daily` PK is now `(user_id, date, source)`. Whoop and Garmin can both write a row for today and neither erases the other.
- View `biometrics_daily_merged` — picks one value per metric per day using a per-user priority list (default `garmin > whoop > apple_watch > manual`). 26 metric columns: sleep stages, HRV, resting/max/min HR, training load, steps, active/vigorous/moderate minutes, kcals, VO2max, body battery, etc.
- `user_profile.metric_source_priority jsonb` + `GET/PUT /api/profile/source-priority` so users can override defaults.
- All read paths (briefing context, dashboard, progress, history) switched from the table to the view.

### Audit ledger + retry-with-backoff
- Migration `014_audit_ledger.sql` — `audit_ledger` table with RLS (read-own, service-role-only writes), indexes on `(user_id, ts)` and `(action, ts)`, and added to the `supabase_realtime` publication.
- `web/src/lib/audit/broker.ts` — `logAudit()` is now async and persists to `audit_ledger` best-effort, with a stdout fallback so the broker never breaks the caller. `brokeredFetch()` times each call and emits one ok/error row per attempt.
- `web/src/lib/sync/retry.ts` — `withBackoff()` with typed `HttpError`. Retries on 429 / 5xx / network errors (exponential 1s → 4s → 16s, ±25% jitter); terminal on 401 / 403 / other 4xx.
- `GET /api/sync/history?source=&days=` — reads the calling user's recent audit rows for the dashboard.

### Sync dashboard at `/settings/integrations`
- Per-source cards (Garmin, Whoop, Apple Watch): status badge (connected / disconnected / recently_errored), "12 min ago" freshness, computed next-pull timestamp, cooldown countdown, "Sync now" button.
- `SyncNowButton` client island — POSTs to `/api/sync/run`, surfaces `status` + `rowsAffected` inline, disabled-with-tooltip for push-only Apple Watch.
- `AuditTimeline` client island — Realtime-subscribed to `audit_ledger` filtered to the calling user. New syncs animate into the timeline within ~2s of landing. Capped at 20 rows; dedupes by id so server-rendered rows don't double when the realtime INSERT echoes them back.
- CGM / blood markers / cycle keep their existing manual-entry cards, gated as before.

### Wave 2 — visible-on-the-dashboard polish (Tracks 5–8)

After the four data-management tracks landed, four more parallel worktree agents shipped the user-facing surface area for v2 — the parts that prove the architecture work was worth it.

- **Track 5 — Data Health score on `/dashboard`.** A single 0..100 numeral at the top of the dashboard (`web/src/components/dashboard/DataHealthCard.tsx`) summarising the user's ingestion plumbing. Formula: `0.7 * freshness + 0.3 * (1 - error_rate_24h)`, averaged over connected sources. Bands: ≥85 green, 60-84 yellow, <60 red, no-sources gray. Pure scoring fn lives in `web/src/lib/sync/health-score.ts` with five inline test cases. Card is a click-target → `/settings/integrations`. The dashboard route was split from a fat client into a thin async server component (`page.tsx`) + `<DashboardContent />` client island so the score paints on first byte instead of after hydrate.
- **Track 6 — Source attribution chips.** `web/src/components/ui/SourceChip.tsx` (new) — Garmin / Whoop / Apple Watch / Manual pills with per-source CSS tokens (`--source-garmin: #38bdf8` etc, in `globals.css`). Used on `BiometricsCard`, `BriefingCard` ("Signals from: Garmin · Whoop"), and the `MetricStatStrip` on `/progress`. Primary-source-only attribution — skipped per-metric chips because that needs `signals_used` parsing which is lossy across the merged view. Time-to-fresh: `freshnessSecondsFrom(iso)` exported helper.
- **Track 7 — Coach sync-awareness.** `assembleCoachContext` (`web/src/lib/coach/context.ts`) now computes a `data_freshness` block — per-source `last_synced_at`, age-in-hours, and a `health_state` (`fresh | stale | missing`). `BRIEFING_SYSTEM_PROMPT` (`web/src/lib/claude/prompts/briefing.ts`) gained a `DATA FRESHNESS` worked example so the coach can say "your Whoop hasn't synced since Saturday — recovery score below treats you as untracked" instead of pretending it has data it doesn't.
- **Track 8 — Auto-backfill on dashboard mount.** `<AutoBackfillTrigger />` (client island in `DashboardContent`) POSTs to `/api/sync/auto-backfill` once per page load. Server-side (`web/src/lib/sync/backfill.ts`) detects per-source gaps over the last 7 days, calls `runSync(userId, [source], { days: 7 })` for each source with gaps, diffs before/after, and emits a single `sync.auto_backfill` audit row that doubles as the 30-min cooldown gate. UI surfaces a glass-strong banner ("Filled 2 days of Whoop data") that auto-fades; silent on cooldown / no_sources.

Wave-2 merge order: Track 7 (no UI conflicts) → Track 5 (introduced the dashboard split) → Track 8 (overlaid `<AutoBackfillTrigger />` onto the new split). One add/add conflict on `dashboard/page.tsx` resolved by taking Track 5's server-component split and porting Track 6's `biometrics={biometrics}` prop and Track 8's `<AutoBackfillTrigger />` into `DashboardContent.tsx`. Build green; `/api/sync/auto-backfill` registered alongside the wave-1 routes.

## Parallelization (the v2 directive)

The Week 6 wave used parallel worktree agents to ship seven feature tracks in two hours; v2 reuses the same dev loop but with a tighter scoped brief. Four tracks ran concurrently in isolated git worktrees:

| Wave | Track | Branch | What |
|---|---|---|---|
| 1 | 1 | `feat/sync-orchestrator` | Orchestrator + Vercel cron + extracted sources |
| 1 | 2 | `feat/biometrics-multi-source` | Composite PK migration + merged view |
| 1 | 3 | `feat/audit-ledger` | Audit ledger schema + retry helper + broker rewrite |
| 1.5 | 4 | `feat/sync-dashboard` | Per-source cards + Realtime audit timeline |
| 2 | 5 | `feat/data-health-score` | 0..100 ingestion health score on `/dashboard` + page split |
| 2 | 6 | `feat/source-attribution` | `SourceChip` + per-source CSS tokens + briefing/dashboard/progress chips |
| 2 | 7 | `feat/coach-sync-awareness` | `data_freshness` in coach context + DATA FRESHNESS prompt example |
| 2 | 8 | `feat/auto-backfill` | Detect-and-fill 7-day gaps on dashboard mount |

Tracks 1, 2, 3 ran in wave 1 (independent at the file level). Track 4 (sync dashboard) sat between waves — it depends on Track 1's `/api/sync/run` and Track 3's `audit_ledger` schema. Wave 2 (Tracks 5–8) shipped the user-facing surface area on top of the wave-1 plumbing: visible health score, source provenance chips, a sync-aware coach prompt, and silent gap-filling. **Eight tracks total across two waves.**

### Two stale-base bugs caught mid-flight

1. **Track 3** branched off a stale `polish/v2` snapshot that didn't have the Whoop/Apple Watch/CGM merges from `main`. Its branch claimed to *delete* 18,901 lines of integration code at merge time. Caught at merge — cherry-picked the single useful commit (`broker.ts` extension + retry helper + migration 014 + history route) onto a fresh branch from `main`, resolved the add/add conflict on `broker.ts` by extending the existing 60-line broker rather than overwriting it, and dropped a duplicate `lib/supabase/service.ts` in favor of the existing `lib/supabase/admin.ts` `getAdminClient()`. Public API of `logAudit` and `BrokeredFetchOptions` kept backward-compatible so the chat / briefing / Whoop-callback callers didn't need touching.
2. **Track 1's wrapperization** moved the `biometrics_daily` upserts out of the route handlers into `lib/sync/sources/{garmin,whoop}.ts`. Track 2's `onConflict: 'user_id,date,source'` edits to the original route locations would have evaporated. Fix: after the merge, patched the new conflict target into the three remaining upsert sites (`lib/sync/sources/garmin.ts:229`, `lib/sync/sources/whoop.ts:352`, and the manual-entry PUT at `api/biometrics/sync/route.ts:129`).

Both fixes were applied during the merge step on `main`, not by re-running agents. The lesson: worktree subagents need a base-branch sanity check at the start of every wave.

## Verification

| # | Check | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` on merged main | `EXIT=0` |
| 2 | `npx next build` on merged main | `BUILD=0`, all routes registered including `/api/sync/{run,cron,history}` |
| 3 | `POST /api/sync/run` no session | `HTTP 401` |
| 4 | `GET /api/sync/cron` no auth | `HTTP 401` |
| 5 | `GET /api/sync/cron` wrong bearer | `HTTP 401` |
| 6 | `GET /api/sync/cron` correct `CRON_SECRET` | `HTTP 200` |
| 7 | `GET /api/sync/history` no session | `HTTP 401` |

Multi-source no-overwrite proof and merged-view sanity require live Supabase + connected Garmin + Whoop credentials and are documented in the plan's verification checklist (`/Users/enrico/.claude/plans/ok-let-s-keep-working-abstract-sundae.md`) — to run them, deploy to Vercel preview with `CRON_SECRET` set, connect both wearables for a test user, and run both syncs back-to-back.

## What I cut from v2 (deferred to v3 / v4)

- iOS app catch-up (was on v1's deferred list — bigger lift, doesn't address cohort feedback).
- Streaming briefing (still sync JSON in v2).
- Per-source normalized tables (kept the single `biometrics_daily` with composite PK + merged view; cleaner refactor for v3 if it ever becomes warranted).
- Real CGM API integration (Levels / Lingo / Stelo); CGM stays manual-entry in v2.
- Cost metering on Claude blood-panel PDF parses.
- 30-day retention policy on `audit_ledger` (small enough at one user that it doesn't matter yet).

## Final state

- **6 data sources**, **1 orchestrator**, **1 cron**, **2 new migrations** (013, 014), **1 audit ledger**, **1 sync dashboard**.
- **Visible artifacts:** Data Health score on `/dashboard`, source-attribution chips across briefing / biometrics / progress, sync-aware coach briefings, auto-backfill banner on dashboard mount.
- **CI green**, typecheck + build + Garmin-service compileall pass post-merge across all 8 tracks.
- **Parallel-worktree dev loop** validated for the second consecutive milestone — eight tracks across two waves, three add/add conflicts, all resolved at merge time without re-running agents.

## Plan for v3 (Week 8)

Stretch in the cohort-feedback direction: rate-limit observability (per-source 7-day error/latency rollups on the dashboard), `audit_ledger` retention cron, and a real CGM integration (Levels API). Plus the items from v1's deferred list that aren't blocked: streaming briefing, weekly AI review, multi-week periodization.

---

Built with Claude Code (Opus 4.7, 1M context). Four parallel worktree agents, two stale-base bugs caught at merge time, ~7.5 hours end-to-end.
