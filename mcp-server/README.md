# protocol-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a Protocol user's Supabase data to Claude Desktop. Open Claude Desktop, ask _"what's my HRV trend been like this week?"_, and Claude reads the answer directly from your Supabase.

This is a sibling sub-package alongside `garmin-service/`. It is **not** part of the Next.js app under `web/` — it is a standalone Node binary that Claude Desktop spawns over stdio.

## What it exposes

Four read-only tools:

| Tool | Args | What it returns |
| --- | --- | --- |
| `get_data_health` | _(none)_ | Per-source connection state (garmin, whoop, apple_watch), last-synced timestamps, hours-since-sync, and 24h ok/error counts from `audit_ledger`. |
| `get_biometrics_range` | `{ metric: string, days: 1..365, source?: 'merged' \| 'garmin' \| 'whoop' \| 'apple_watch' \| 'manual' }` | Chronological `[{date, value}]` series for one column on `biometrics_daily_merged` (default) or `biometrics_daily` (specific source), plus a `min/mean/max` summary. |
| `get_today_briefing` | _(none)_ | Today's `daily_briefing` row — `recovery_note` text, `workout` JSON, `meals` array, `model`, `prompt_cache_hit`. |
| `get_recent_audit` | `{ days?: 1..30, action_filter?: string }` | Latest 50 `audit_ledger` rows for the user, with success/error/retry counts. |

## Install

```bash
cd mcp-server
npm install
npm run build
```

That writes `dist/index.js`, which is the file Claude Desktop will run.

## Claude Desktop config

Add this block to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "protocol": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOi...",
        "PROTOCOL_USER_ID": "00000000-0000-0000-0000-000000000000"
      }
    }
  }
}
```

Restart Claude Desktop. The server appears in the tool picker as `protocol`. Ask:

- _"What's my HRV trend been like this week?"_
- _"How did I sleep over the last 30 days?"_
- _"What's on my Protocol briefing today?"_
- _"Did anything error in my data sync today?"_

## Security model

**Read this before you put your service-role key in a config file.**

- This server holds `SUPABASE_SERVICE_ROLE_KEY` in its environment. That key bypasses Supabase Row Level Security entirely — it can read every row in your database.
- The only authorization gate is the `PROTOCOL_USER_ID` env var. Every tool scopes its query with `eq('user_id', PROTOCOL_USER_ID)`. There is no sign-in step, no per-call auth check, nothing else.
- **Anyone with these env vars can read this user's data.** Treat the config file as a secret.
- **Do not host this server publicly.** It is intended to run as a stdio subprocess of Claude Desktop on your own machine. There is no HTTP transport, no rate limit, no logging boundary.
- The server is read-only by code: every Supabase call is `.select(...)` — there are no `insert/update/delete` paths. But the service-role key can do those operations; if you need stricter guarantees, mint a custom Postgres role with `SELECT` only and use that key instead.
- The server logs tool failures to stderr (Claude Desktop captures these in its MCP log). Errors include Supabase error messages but not the service-role key. Don't ship the log files anywhere.

## Schema dependencies

The server reads these objects from your Supabase. They all exist after running migrations 001–014 in `web/supabase/migrations/`:

- `biometrics_daily` (table) and `biometrics_daily_merged` (view, migration 013)
- `daily_briefing` (table)
- `audit_ledger` (table, migration 014)
- `garmin_credentials`, `whoop_credentials`, `apple_watch_tokens` (presence checks for connection state)

If you run this against a database without those, the affected tools will return MCP errors instead of crashing.

## Files

```
mcp-server/
  package.json       # name: protocol-mcp, type: module, bin: protocol-mcp
  tsconfig.json      # ES2022 / Node16 ESM
  src/
    index.ts         # stdio entrypoint, registers tool handlers
    tools.ts         # the four tool definitions + handlers
    supabase.ts      # service-role client + env validation
```

## Why not put this in `web/`?

Because Claude Desktop spawns it as a standalone Node process and the Next.js bundle is irrelevant. Keeping it as a sibling package mirrors `garmin-service/` (Python on Railway) — separate runtimes have separate dependency trees.
