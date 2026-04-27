<h1 align="center">Protocol</h1>

<p align="center">
  <em>An AI personal health coach. Garmin biometrics + nutrition + adaptive daily plans.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat&logo=next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=000" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=fff" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=fff" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat&logo=tailwindcss&logoColor=fff" />
  <img src="https://img.shields.io/badge/Claude-Sonnet%204.6-D97757?style=flat" />
</p>

---

## What it is

Protocol turns the data your watch and food log already collect into one decision per day: **what to eat, what to train, how to recover.** Bryan Johnson runs a $2M/year team to do this for himself. Protocol does it with Claude.

Every morning it reads your overnight Garmin data — sleep, HRV, RHR, stress, training load — pulls your last 24 h of macros, looks at yesterday's workout, and produces:

1. **Three meals** with specific foods and macros that hit your daily targets and your training day's needs.
2. **One workout** adapted to your goals *and* your recovery state. Not a generic template.
3. **A recovery note.**

Then it gets out of the way. If your day changes — "I only have 30 minutes today" — open the chat. Claude will rewrite the workout in place, with reasoning.

## Origin

Protocol is the project for **MPCS 51238 — Design, Build, Ship** at UChicago, Spring 2026. It's built across versions v1 (Week 6) through v4 (Week 9 project fair).

It's forked from [MacroTracker](https://github.com/enricopioppi/macrotracker), my dual-platform (Next.js + SwiftUI iOS) macro-tracking app. MacroTracker's nutrition logging, food search across OpenFoodFacts/USDA/Nutritionix, recipes, and meal templates become Protocol's data foundation. Architectural patterns (streaming Claude client with prompt caching, audited outbound HTTP, conversation state machine, AI dock UI) are translated from my macOS genomics app, [HELIX](https://github.com/enricopioppi/helix), into TypeScript.

The class brief explicitly invites projects to evolve and reuse prior work. The original MacroTracker commit history is preserved on the `polish/v2` branch; Protocol's new commits live on `main` from v1 onward.

## Roadmap

**v1 — Week 6 (this milestone).** End-to-end demo loop. Dashboard with live biometrics + macros + AI briefing. Chat slide-over with `regenerate_workout` tool. Garmin integration via `garminconnect` Python service on Railway, with manual entry as fallback. Web only.

**v2 — Week 7.** iOS app catches up. Realtime sync between web and iOS. Streaming briefing (instead of sync JSON). Apple Health bridge. Cron-driven nightly Garmin sync. Audit ledger persisted to Supabase.

**v3 — Week 8.** Readiness score (HRV + sleep + load synthesis). Weekly AI review. Multi-week workout periodization. `swap_meal` tool. Citations / provenance UI on briefing output.

**v4 — Week 9, project fair.** "Don't Die" dashboard. Sleep optimization engine. Supplement protocol. Polish.

## Stack

**Web app** (`web/`) — Next.js 16 / React 19 / TypeScript / Tailwind 4 / Supabase (Postgres + Auth + Realtime + RLS) / Claude Sonnet 4.6 via `@anthropic-ai/sdk`.

**iOS app** (`MacroTracker/`) — SwiftUI / SwiftData / VisionKit barcode scanner. Inherited from MacroTracker. Not the v1 target; v2 onward.

**Garmin service** (`garmin-service/`) — single FastAPI file deployed to Railway. Wraps the `garminconnect` community library. Bearer-token-protected. Vercel routes call it server-to-server.

## Local setup (web)

```bash
cd web
npm install

# Configure
cp .env.example .env.local
# fill in:
#   NEXT_PUBLIC_SUPABASE_URL=
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=
#   SUPABASE_SERVICE_ROLE_KEY=
#   ANTHROPIC_API_KEY=
#   GARMIN_SERVICE_URL=          (Railway URL, optional for v1 — manual entry works without)
#   GARMIN_SERVICE_TOKEN=
#   GARMIN_ENC_KEY=              (32 bytes, base64 — for AES-256 of stored Garmin passwords)

# Run migrations against your Supabase project
#   supabase/migrations/001_initial_schema.sql
#   supabase/migrations/002_enable_realtime.sql
#   supabase/migrations/003_add_fiber.sql
#   supabase/migrations/004_protocol_v1.sql

npm run dev
```

## License

MIT. Built with Claude Code.
