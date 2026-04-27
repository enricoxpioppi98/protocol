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

## v2 — Week 7 (planned)

iOS catches up. Realtime sync between web and iOS. Streaming briefing. Apple Health bridge. Cron-driven nightly Garmin sync. Audit ledger persisted to Supabase.

## v3 — Week 8 (planned)

Readiness score (HRV + sleep + load synthesis). Weekly AI review. Multi-week workout periodization. Citations / provenance UI on briefing output.

## v4 — Week 9 / project fair (planned)

"Don't Die" dashboard. Sleep optimization engine. Supplement protocol. Polish.
