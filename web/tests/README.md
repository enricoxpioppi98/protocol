# Tests

The v1 end-to-end smoke test for the demo loop lives at `v1-loop.spec.ts`. It exercises the seven-step flow documented in `/VERIFICATION.md`: signup → onboarding → log macros → biometrics sync (or manual entry) → generate briefing → chat regenerate_workout → assert workout was rewritten.

## Setup

```bash
cd web
npm install -D @playwright/test
npx playwright install chromium
```

## Running

The test requires a running dev server and a real Supabase + Anthropic env. Bring up the stack first:

```bash
# in one terminal
cd web && npm run dev

# in another
cd web && npx playwright test
```

It expects these env vars (`.env.test.local`):

```
PROTOCOL_TEST_EMAIL=test+protocol@example.com
PROTOCOL_TEST_PASSWORD=<some-password>
PROTOCOL_TEST_BASE_URL=http://localhost:3000
```

The test spec uses `test.skip(!process.env.PROTOCOL_TEST_EMAIL, …)` so CI will skip it cleanly when the env isn't configured. Wire it into `playwright.config.ts` once the deps are installed.
