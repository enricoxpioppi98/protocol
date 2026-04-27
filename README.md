<h1 align="center">Protocol</h1>

<p align="center">
  <em>An AI personal health coach that turns your Garmin data and food log into one decision per day: what to eat, what to train, how to recover.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat&logo=next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=000" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=fff" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=fff" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat&logo=tailwindcss&logoColor=fff" />
  <img src="https://img.shields.io/badge/Claude-Sonnet%204.6-D97757?style=flat" />
</p>

<p align="center">
  Source: <a href="https://github.com/enricoxpioppi98/protocol">github.com/enricoxpioppi98/protocol</a> &middot; private during development; flips public for class submission.
</p>

---

## At a glance

- **One daily plan, generated from your data.** Three meals, one workout, one recovery note — built each morning from your overnight Garmin metrics, last 24 h of macros, and yesterday's session.
- **Adaptive on demand.** Open the chat and say "I only have 30 minutes today" — Claude rewrites the workout in place with reasoning, via a tool-calling loop.
- **Single-screen dashboard.** Biometrics, macros, and today's briefing in one view. No menus, no setup ritual.
- **Manual fallback for everything.** Garmin sync is optional. Manual biometrics entry, manual food logs, manual workouts — the whole loop works without a watch.

## Demo

![Dashboard](docs/dashboard.png)

The v1 demo loop: open the dashboard in the morning, sync Garmin (or enter biometrics manually), tap **Generate today's briefing**, and Claude reads your overnight HRV / sleep / RHR plus your last-24h macros and yesterday's workout to produce three meals, one adaptive workout, and a recovery note. Open chat, ask for a shorter session, and watch the workout rewrite itself in place with the regenerated badge highlighted.

## Origin

Protocol is the project for **MPCS 51238 — Design, Build, Ship** at UChicago, Spring 2026, built across versions v1 (Week 6) through v4 (Week 9 project fair).

It's forked from [MacroTracker](https://github.com/enricopioppi/macrotracker) — my dual-platform (Next.js + SwiftUI iOS) macro-tracking app. MacroTracker's nutrition logging, food search across OpenFoodFacts/USDA/Nutritionix, recipes, and meal templates become Protocol's data foundation. Architectural patterns (streaming Claude client with prompt caching, audited outbound HTTP, conversation state machine, AI dock UI) are translated from my macOS genomics app, [HELIX](https://github.com/enricopioppi/helix), into TypeScript. The class brief explicitly invites projects to evolve and reuse prior work; the original MacroTracker history is preserved on the `polish/v2` branch.

## Roadmap

- **v1 — Week 6 (this milestone).** End-to-end demo loop: dashboard, biometrics, macros, AI briefing, chat with `regenerate_workout` tool, Garmin via `garminconnect` on Railway, web only.
- **v2 — Week 7.** iOS catches up. Realtime sync between web and iOS, streaming briefing, Apple Health bridge, nightly cron sync, Supabase-persisted audit ledger.
- **v3 — Week 8.** Readiness score (HRV + sleep + load), weekly AI review, multi-week periodization, `swap_meal` tool, citations on briefing output.
- **v4 — Week 9 / project fair.** "Don't Die" dashboard, sleep optimization engine, supplement protocol, polish.

## Stack

- **Web** (`web/`) — Next.js 16, React 19, TypeScript, Tailwind 4, Supabase (Postgres + Auth + Realtime + RLS), Claude Sonnet 4.6 via `@anthropic-ai/sdk`.
- **iOS** (`MacroTracker/`) — SwiftUI, SwiftData, VisionKit. Inherited; v2 onward.
- **Garmin service** (`garmin-service/`) — single-file FastAPI app on Railway, wraps `garminconnect`, bearer-token auth, called server-to-server from Vercel.

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
#   GARMIN_ENC_KEY=              (32 bytes, base64 — AES-256 for stored Garmin passwords)
#   GOOGLE_GENERATIVE_AI_API_KEY (optional, inherited from MacroTracker for AI food estimation)

# Run migrations against your Supabase project (in order)
#   supabase/migrations/001_initial_schema.sql
#   supabase/migrations/002_enable_realtime.sql
#   supabase/migrations/003_add_fiber.sql
#   supabase/migrations/004_protocol_v1.sql

npm run dev
```

## License

MIT. Built with Claude Code.
