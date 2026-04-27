/**
 * Protocol v1 — end-to-end demo loop smoke test.
 *
 * Mirrors the seven-step verification flow in /VERIFICATION.md.
 *
 * This file is excluded from the main tsconfig (the tests/ directory has its
 * own toolchain). To enable:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *   npx playwright test
 *
 * The scaffold below documents the end-to-end flow; fill in selectors and
 * assertions once @playwright/test is installed.
 */

// @ts-expect-error — @playwright/test isn't installed yet; this file is a scaffold.
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PROTOCOL_TEST_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROTOCOL_TEST_EMAIL;
const PASSWORD = process.env.PROTOCOL_TEST_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'PROTOCOL_TEST_EMAIL / PROTOCOL_TEST_PASSWORD not set — skipping live e2e'
);

test('v1 demo loop: signup → onboarding → diary → biometrics → briefing → chat regenerate', async ({
  page,
}) => {
  // 1. Sign up (or sign in if already exists) — onboarding redirect lands at /onboarding
  await page.goto(`${BASE_URL}/signup`);
  // ...

  // 2. Complete onboarding (Goals → Restrictions+Equipment → Schedule)

  // 3. Log a breakfast on /diary

  // 4. Enter biometrics manually from dashboard

  // 5. Generate today's briefing — assert 3 meals + workout + recovery_note render
  await expect(page.getByRole('heading', { name: /today.*plan/i })).toBeVisible();

  // 6. Open chat slide-over → "I only have 30 minutes today." →
  //    assert tool chip cycles pending → success → workout duration_minutes ≤ 30

  // 7. Verify briefing card re-renders with the regenerated workout
});
