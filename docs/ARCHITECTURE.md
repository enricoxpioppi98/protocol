# Protocol — architecture

A short tour of how the v1 system fits together. For graders, future-me, and anyone who lands in the repo cold.

## Three processes

```
┌─────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
│  Browser        │◄──►│  Next.js (Vercel)   │◄──►│  Supabase          │
│  React 19 +     │    │  routes + SSE +     │    │  Postgres + RLS +  │
│  Tailwind 4     │    │  Anthropic SDK      │    │  Auth + Realtime   │
└─────────────────┘    └─────────┬───────────┘    └────────────────────┘
                                 │
                                 ▼
                       ┌─────────────────────┐
                       │  Garmin service     │
                       │  FastAPI (Railway)  │
                       │  garminconnect lib  │
                       └─────────────────────┘
```

The web app is the only thing the user sees. Vercel's Next.js routes are the only thing that talks to Anthropic and Garmin. Supabase holds all the state. The Railway service exists because `garminconnect` is too slow on Vercel cold starts.

## Data flow — the morning briefing

```
User opens /dashboard
   ▼
DashboardPage fetches:
   biometrics_daily ── (last sync, may be Garmin or manual)
   daily_briefing for today (may be empty)
   diary_entries for today (existing MacroTracker tables)
   ▼
If briefing empty: user clicks "Generate today's briefing"
   ▼
POST /api/briefing/today
   ▼
assembleCoachContext():
   user_profile · biometrics_daily (today, falling back to yesterday)
   diary_entries (last 24h, joined to foods/recipes, aggregated to macros)
   daily_briefing (yesterday's workout for periodization continuity)
   daily_goals (for the right day-of-week)
   ▼
Anthropic Messages API:
   system: [BRIEFING_SYSTEM_PROMPT (cached), USER_PROFILE (cached), …]
   tools:  [emit_briefing]            ← input_schema = strict shape
   tool_choice: {type:"tool", name:"emit_briefing"}
   user message: contextToPromptInput(ctx)   ← compact JSON, uncached
   ▼
Tool input parsed and validated → upsert daily_briefing
   ▼
Response rendered in BriefingCard
```

Caching strategy: the system prompt + per-user profile prefix are reused by the chat endpoint. Cache hits stack across both endpoints for the same user/day.

## Data flow — the chat moment

```
User opens chat slide-over → loads chat history (last 50, GET /api/chat/history)
   ▼
User sends "I only have 30 minutes today."
   ▼
ChatSlideOver POSTs to /api/chat (SSE)
   ▼
Server inserts user row to chat_messages immediately
   ▼
anthropic.messages.stream() with the same cached prefix
   plus a CHAT_SYSTEM_ADDENDUM
   plus today's state JSON + today's briefing JSON
   tools: [regenerate_workout (and swap_meal in F)]
   ▼
Stream events forwarded as SSE:
   text → text_delta
   content_block_start (tool_use) → tool_use_start
   content_block_delta (input_json_delta) → tool_input_delta
   ▼
On stop_reason="tool_use":
   server runs the tool handler
   regenerateWorkout(): focused Claude sub-call → emit_workout tool
   updates daily_briefing.workout, sets regenerated_at
   emits tool_executing → tool_result
   ▼
Loop continues with the assistant's tool_use turn + tool_result turn
   max 3 round-trips
   ▼
Final assistant text streams to client
   ▼
Server inserts assistant row to chat_messages (with final tool list)
   ▼
Realtime subscription on daily_briefing → BriefingCard re-renders
   ▼
Realtime subscription on chat_messages → useChatHistory refetches
```

## Schema map

```
auth.users (Supabase managed)
    │
    ├── user_profile         (1:1, freeform JSON for goals/restrictions/etc)
    ├── user_settings        (inherited; API keys for Nutritionix etc.)
    ├── garmin_credentials   (encrypted password — service-role-only access)
    │
    ├── biometrics_daily     (PK user_id+date)
    ├── daily_briefing       (PK user_id+date)
    ├── chat_messages        (one row per turn)
    │
    ├── foods                (inherited; user food library)
    ├── recipes ─── recipe_ingredients
    ├── diary_entries        (the daily food log)
    ├── daily_goals          (per day-of-week macro targets)
    ├── meal_templates ─── meal_template_items
    └── weight_entries
```

RLS on everything. `garmin_credentials` deliberately omits a SELECT policy for authenticated clients — server routes use the service role key.

## Where HELIX patterns live

| HELIX (Swift / macOS) | Protocol (TypeScript) |
|---|---|
| `ReasoningKit/ClaudeClient.swift` | `web/src/lib/claude/{client,stream,prompts/*}.ts` |
| `PrivacyKit/OutboundBroker.swift` | `web/src/lib/audit/broker.ts` |
| `App/ConversationSession.swift`   | `web/src/components/coach/ChatSlideOver.tsx` (state machine + SSE consumer) |
| `App/Views/AIDock/MessageBubble`  | `web/src/components/coach/MessageBubble.tsx` |
| `App/Views/AIDock/ToolActivityChip` | `web/src/components/coach/ToolActivityChip.tsx` |

The SSE event vocabulary intentionally matches HELIX's local event names (`text`, `tool_use_start`, `tool_input_delta`, `tool_executing`, `tool_result`, `error`, `done`) so the iOS app in v2 can plug into the same client state machine without translation.
