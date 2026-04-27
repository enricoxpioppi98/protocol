# Protocol v1 — Verification Runbook

End-to-end checklist for proving the v1 demo loop works. Tracks the plan's
"Verification" section. Run top-to-bottom; if a step fails, stop and fix.

## 0. Environment

```bash
cd web
npm install
cp .env.example .env.local
```

Fill `.env.local`:

| Var | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | same — **server-only**, never client-side |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `GARMIN_SERVICE_URL` | Railway URL after deploy (optional in v1 — manual entry works without) |
| `GARMIN_SERVICE_TOKEN` | `openssl rand -hex 32` (set the same value on Railway) |
| `GARMIN_ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

## 1. Supabase setup

1. Create a new Supabase project (free tier).
2. SQL editor → run, in order:
   - `web/supabase/migrations/001_initial_schema.sql`
   - `web/supabase/migrations/002_enable_realtime.sql`
   - `web/supabase/migrations/003_add_fiber.sql`
   - `web/supabase/migrations/004_protocol_v1.sql`
3. Authentication → Settings → enable Email auth.

## 2. (Optional) Garmin service on Railway

```bash
cd garmin-service
# Railway: create project, link repo dir, set GARMIN_SERVICE_TOKEN env var.
```

Smoke test the deployed service:
```bash
curl https://<your-app>.up.railway.app/health
# {"ok": true}
```

Set `GARMIN_SERVICE_URL` and the same `GARMIN_SERVICE_TOKEN` in Vercel /
`.env.local`.

## 3. Local smoke test

```bash
cd web
npm run dev
```

1. Visit http://localhost:3000 — redirects to `/login`.
2. Sign up. Verify email if your Supabase project requires it.
3. Land on `/dashboard`. Three cards render:
   - **Biometrics** — empty, prompts to sync or edit.
   - **Today's macros** — empty, all zeros vs default goals.
   - **Today's plan** — empty, shows "Generate today's briefing" button.

## 4. Log macros

1. Click **Diary** in sidebar.
2. Add a breakfast and a lunch via food search or barcode scan.
3. Return to Dashboard — MacrosCard now shows non-zero kcal/P/C/F.

## 5. Biometrics

**Garmin path** (if Railway service is up):
1. Settings → Integrations → enter Garmin email + password → Connect.
2. Dashboard → click sync icon on BiometricsCard.
3. Card populates with sleep score, HRV, RHR, stress.

**Manual path**:
1. Dashboard → click edit icon on BiometricsCard.
2. Enter sleep_score / hrv / rhr / stress.
3. Card populates; chip shows "manual."

Verify in Supabase:
```sql
select * from biometrics_daily where user_id = auth.uid();
```

## 6. Generate the briefing

1. Dashboard → click **Generate today's briefing**.
2. ~5–10s wait, then BriefingCard renders:
   - 3 meals with names, items (food + grams), macros.
   - 1 workout with named blocks, sets/reps/intensity.
   - Recovery note connecting biometrics → today's plan.
3. Verify in Supabase: one row in `daily_briefing` for `(user_id, today)`.

## 7. The chat tool moment (v1's "wow")

1. Dashboard → click the message-square FAB (bottom right).
2. Click suggestion chip: **"I only have 30 minutes today."**
3. Observe stream:
   - Text deltas stream into the assistant bubble.
   - `tool_use_start` → "Rewriting today's workout" chip appears, pending.
   - `tool_executing` → chip transitions to running.
   - `tool_result` → chip turns green (success).
   - Final text: brief explanation of what changed.
4. BriefingCard re-renders automatically (Realtime). New workout has
   `duration_minutes ≤ 30`. `regenerated_at` chip appears on the card.

Verify in Supabase:
```sql
select date, regenerated_at, workout
from daily_briefing
where user_id = auth.uid() and date = current_date;
```
`regenerated_at` should be set; `workout->>'duration_minutes'` should be ≤ 30.

## 8. Production build + deploy

```bash
cd web
npm run build       # must finish clean
```

For Vercel:
1. Push the repo to GitHub (`gh repo create protocol --public --source=. --remote=origin --push`).
2. Vercel → Import → select repo → set the env vars from §0 (and the
   Garmin ones if used).
3. Smoke-test §3–§7 on the deploy URL.

## 9. Submission (Google Classroom)

- [ ] GitHub URL: https://github.com/<you>/protocol
- [ ] Vercel URL: https://protocol-<hash>.vercel.app
- [ ] Agent-generated weekly summary: see `WEEK6_SUMMARY.md` (or paste the
  contents directly into the post)
- [ ] Optional: short video walkthrough of §3–§7
