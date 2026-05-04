# Changelog

All notable changes to Protocol. The project follows the v1 → v4 milestones for MPCS 51238 — Design, Build, Ship.

## v1 — 2026-04-26 (Week 6 milestone)

### Added — initial AI coaching layer
- `/dashboard` route — three cards (Biometrics, Macros, Briefing) plus a floating chat FAB. Realtime-subscribed to `daily_briefing` and `biometrics_daily`.
- `POST /api/briefing/today` — Claude Sonnet 4.6 with prompt caching on the system prompt + per-user profile, forced tool-use of `emit_briefing` for guaranteed JSON, idempotent unless `?regenerate=1`.
- `POST /api/chat` — Server-Sent Events streaming with the `regenerate_workout` tool. Multi-turn agent loop capped at 3 round-trips. Reuses the briefing's prompt-cache prefix.
- `POST /api/biometrics/sync` — Garmin proxy via the Railway service, with a manual entry fallback wired from day one (PUT).
- `POST/GET/DELETE /api/integrations/garmin` — AES-256-GCM encrypted Garmin credentials at rest, server-only decryption.
- `garmin-service/` — single-file FastAPI on Railway wrapping `garminconnect`. Bearer-token-auth'd, stateless.
- Migration `004_protocol_v1.sql` — `user_profile`, `biometrics_daily`, `daily_briefing`, `garmin_credentials` tables. RLS on all four; realtime enabled on the daily ones.

### Added — autonomous build-out wave (same day)
- **Onboarding** — `/onboarding` 3-step form (goals → restrictions+equipment → weekly schedule). Signup redirects to it, dashboard shows a banner if profile is empty.
- **Coach prompt depth** — `BRIEFING_SYSTEM_PROMPT` extended from 3 → 5 worked examples (added DELOAD WEEK DAY and CALORIE CUT DAY). Tightened guardrails (RPE/threshold cap by sleep+HRV, fat ceiling, dietary-restriction enforcement). New `BIOMETRICS_MISSING` heuristics block. New `CHAT_MODE` callout.
- **Chat persistence** — Migration `005_chat_persistence.sql` with `chat_messages` table. Chat history loads when slide-over opens; clear button deletes all.
- **Visual polish** — Polished BriefingCard / BiometricsCard / MacrosCard. Dashboard hero header. App icons. README rewrite. Login/signup subtitles.
- **Tooling** — LICENSE (MIT), Playwright scaffold (`web/tests/v1-loop.spec.ts`), GitHub Actions CI workflow staged in `.github-deferred/` pending OAuth scope refresh.

### Stack baseline (inherited from MacroTracker)
- Web: Next.js 16 / React 19 / TypeScript / Tailwind 4 / Supabase
- iOS: SwiftUI / SwiftData / VisionKit (not the v1 target — v2 onward)
- Food data: OpenFoodFacts, USDA, Nutritionix
- AI food estimation: Gemini 2.5-flash (left unchanged from MacroTracker)
- AI coaching: Claude Sonnet 4.6 via `@anthropic-ai/sdk`

## v2 — 2026-05-04 (Week 7 milestone) — data management hardening

Cohort feedback at v1 review: with six data sources now wired (Garmin, Whoop, Apple Watch, CGM, blood markers, cycle), think hard about polling frequency, rate limits, and database load. v2 turns that feedback into a coherent ingestion architecture.

### Added — sync orchestrator + scheduled cron
- `web/src/lib/sync/{orchestrator.ts, policy.ts}` — `runSync(userId, sources, opts)` with per-source min-interval policy (Garmin 1h, Whoop 15min, Apple Watch push-only). In-process per-user lock so concurrent triggers coalesce.
- `web/src/lib/sync/sources/{garmin.ts, whoop.ts}` — fetcher logic extracted from the sync routes; both the manual button path and the orchestrator share the same code.
- `POST /api/sync/run` — authenticated user-triggered sync; body `{ sources?, force?, days? }`.
- `GET/POST /api/sync/cron` — `Bearer ${CRON_SECRET}` auth; fans out across all users with at least one connected integration.
- `web/vercel.json` — daily cron `0 8 * * *` UTC → `/api/sync/cron`.
- Existing `POST /api/biometrics/sync` and `POST /api/biometrics/sync-whoop` are now thin wrappers; the dashboard's "Pull 7 days" button is unchanged.

### Added — kill silent same-day overwrites
- Migration `013_biometrics_multi_source.sql` — `biometrics_daily` PK changes from `(user_id, date)` to `(user_id, date, source)`. Each source keeps its own row per day.
- New `biometrics_daily_merged` view — picks one value per metric per day using a per-user priority list (default: garmin > whoop > apple_watch > manual). 26 metric columns aggregated.
- `user_profile.metric_source_priority jsonb` column with sensible default.
- `GET/PUT /api/profile/source-priority` — let users override.
- All read sites (briefing context, dashboard, progress charts, history) switched from the table to the merged view.

### Added — audit ledger + retry-with-backoff
- Migration `014_audit_ledger.sql` — `audit_ledger(user_id, ts, actor, action, target, purpose, status, ms_elapsed, rows_affected, error_message, payload)` with RLS (read-own, service-role-only writes) and `supabase_realtime` publication.
- `web/src/lib/audit/broker.ts` — `logAudit()` now persists to `audit_ledger` (best-effort; stdout fallback). `brokeredFetch()` is timed and emits one ok/error row per call.
- `web/src/lib/sync/retry.ts` — `withBackoff()` with typed `HttpError`. Retries 429/5xx/network-error, terminal on 401/403/4xx-other, exponential 1s/4s/16s with ±25% jitter.
- `GET /api/sync/history?source=&days=` — reads the calling user's recent audit rows.

### Added — sync dashboard at `/settings/integrations`
- Per-source cards (Garmin, Whoop, Apple Watch): connected/disconnected/recently-errored badge, "12 min ago" freshness, next-pull timestamp, cooldown countdown, "Sync now" button.
- `SyncNowButton` client component — POSTs to `/api/sync/run` for that source, surfaces `status`/`rowsAffected` inline, disabled with tooltip for push-only Apple Watch.
- `AuditTimeline` client component — Realtime-subscribed to `audit_ledger` filtered to the user; new syncs animate in within ~2s of completion. Capped at 20 rows, dedup by id.
- CGM / blood markers / cycle keep their existing manual-entry surface area, gated as before.

### Added — wave 2: visible-on-the-dashboard polish
- **Data Health score** at the top of `/dashboard` — `web/src/components/dashboard/DataHealthCard.tsx` (server) + `web/src/lib/sync/health-score.ts` (pure scoring). 0..100 numeral with band (green/yellow/red/gray), 70% freshness + 30% (1 - 24h error rate). Click → `/settings/integrations`. The dashboard route was split into a thin async server `page.tsx` + `<DashboardContent />` client island so the score paints on first byte.
- **Source attribution chips** — `web/src/components/ui/SourceChip.tsx` with `--source-garmin / --source-whoop / --source-apple-watch / --source-manual` CSS tokens in `globals.css`. Used on `BiometricsCard`, `BriefingCard` (a "Signals from: Garmin · Whoop" line under the recovery note), and `MetricStatStrip` on `/progress`. Primary-source attribution (per-day), not per-metric — the merged view's `signals_used` is too lossy to attribute individually.
- **Sync-aware coach** — `assembleCoachContext` in `web/src/lib/coach/context.ts` now emits a `data_freshness` block (per-source `last_synced_at`, hours-since, `health_state` of `fresh|stale|missing`). `BRIEFING_SYSTEM_PROMPT` gained a `DATA FRESHNESS` worked example so the coach can call out stale sources instead of pretending it has data it doesn't.
- **Auto-backfill on dashboard mount** — `<AutoBackfillTrigger />` (client island) POSTs to `POST /api/sync/auto-backfill`; `web/src/lib/sync/backfill.ts` detects per-source gaps over the last 7 days, calls `runSync` for sources with gaps, and emits one `sync.auto_backfill` audit row that doubles as a 30-min cooldown gate. UI surfaces "Filled 2 days of Whoop data" then auto-fades; silent on cooldown / no_sources.

### Added — wave 3: wow factor (built beyond the v2 spec, into v3 territory)
- **Rolling self-baselines on `/progress`** — `lib/coach/baselines.ts` (pure) + 7d/30d/90d/365d window selector + σ-banded delta chips on every metric ("30d median 51 · ±σ 6 · today 42 (−1.5σ)"). Reads from the merged view; uses URL `?window=30` to persist selection.
- **Anomaly-led briefings** — `lib/coach/anomaly.ts` exports `computeAnomalies()` over a trailing 28d window with z-thresholding, similar-past lookups, and a `summarizeForPrompt()` helper. Pure function, no DB; inline test cases pin the math. Wired into `assembleCoachContext` so the briefing leads the recovery note with personal-baseline language when |z|>1.5.
- **Long-term coach memory** — Migration `015_coach_memory.sql` (pgvector + ivfflat cosine index + RLS read-own / service-role-only writes). `lib/coach/memory.ts` exposes `embed()`, `indexMemory()`, `recallRelevant()` against OpenAI `text-embedding-3-small` (1536-dim). Direct fetch — no `openai` SDK install required. New cron route `GET/POST /api/coach/memory/reindex` (Bearer `CRON_SECRET`); daily at 09:00 UTC via a second `vercel.json` entry. Chat route passes user's latest turn as recall query; briefing route uses a synthesized state query.
- **Genome × coaching overlay** — `lib/coach/genome-context.ts` — `relevantGenomeFlags()` returns up to 8 actionable categories from the existing genome upload: CYP1A2 (caffeine), MCM6/LCT (lactose), ACTN3 (power vs endurance), PPARGC1A (mitochondrial), COMT (warrior/worrier), PER3 (chronotype), HFE (iron storage), ADH1B (alcohol). Defense-in-depth allow-list filters out health-disease SNPs even if the catalog is later edited. One catalog addition (HFE rs1799945 H63D); APOE compound diplotype.
- **Protocol MCP server** — New top-level `mcp-server/` package (sibling of `garmin-service/`). Stdio transport via the official `@modelcontextprotocol/sdk`. Tools: `get_data_health`, `get_biometrics_range`, `get_today_briefing`, `get_recent_audit`. Service-role authorization scoped by `PROTOCOL_USER_ID` env var. README documents the security model loudly.
- **Track 14 wire-up** — `assembleCoachContext` now accepts `opts.recallQuery`; `CoachContext` gains `anomalies`, `recall`, `genome_flags`. `BRIEFING_SYSTEM_PROMPT` gained three new sections (ANOMALIES, PAST_CONTEXT, GENOME_FLAGS) and one worked example demonstrating the anomaly-led + recall + genome-aware case.

### Parallelization (the v2 directive)
- **Fourteen worktree-isolated tracks across three waves.** Wave 1: orchestrator, multi-source PK, audit ledger, dashboard UI. Wave 2: data health score, source chips, coach awareness, auto-backfill. Wave 3: trend baselines, anomaly module, MCP server, RAG memory, genome overlay, sequential wire-up. Four stale-base / overlap bugs caught and resolved at merge time without re-running agents. Wave 3 also caught a "merges landed in the wrong checkout" bug (shell cwd had drifted) — typecheck surfaced it, stash + FF fixed it. Same parallel-agent dev loop the class is teaching, applied to the project itself — at three+ times the scale of v1.

### Risks accepted
- Vercel Hobby plan allows two daily crons; one is plenty for v2.
- Cron at 08:00 UTC = midnight PT — fine for nightly Garmin/Whoop pull.
- No retention policy on `audit_ledger` yet; v3 adds a 30-day TTL cron.

## v3 — Week 8 (planned, partially shipped early in v2 wave 3)

Already shipped in v2 wave 3: rolling self-baselines on /progress, anomaly-led briefings, coach long-term memory (RAG), genome × coaching overlay, MCP server. Remaining for v3: readiness score (HRV + sleep + load synthesis), weekly AI review, multi-week workout periodization, citations / provenance UI on briefing output, real CGM API integration (Levels), `audit_ledger` 30-day retention cron.

## v4 — Week 9 / project fair (planned)

"Don't Die" dashboard. Sleep optimization engine. Supplement protocol. Polish.
