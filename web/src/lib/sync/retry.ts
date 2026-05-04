/**
 * Exponential backoff retry helper for the sync orchestrator (Track 1).
 *
 * API choice: callers throw a typed HttpError with a `.status` field on
 * non-2xx responses; native fetch network errors and AbortError pass
 * through unwrapped. withBackoff classifies retriable vs terminal off
 * those types — no `classify` predicate needed at the call site, which
 * keeps Garmin/Whoop wrappers terse. To override classification (e.g. for
 * a custom transport), throw an object with `.status` and `.retriable`.
 */

export interface RetryOptions {
  /** Default 3. Total tries including the first. */
  maxAttempts?: number;
  /** Default 1000ms. Wait grows as baseDelayMs * 4^(attempt-1) (1s, 4s, 16s). */
  baseDelayMs?: number;
  /** Default 16000ms. Caps the per-attempt wait. */
  maxDelayMs?: number;
  /**
   * Hook invoked before each retry (NOT before the first attempt). The
   * orchestrator uses this to write an audit_ledger row with status='retry'.
   * `attempt` is 1-indexed and counts the attempt that just failed.
   */
  onAttempt?: (attempt: number, lastError: unknown) => void;
}

/**
 * HTTP error that withBackoff understands. Throw this from your fetch
 * wrapper when `response.ok` is false:
 *
 *   if (!res.ok) throw new HttpError(res.status, `Garmin ${res.status}`);
 *
 * 401/403 → terminal (auth is broken, retrying won't help).
 * 408/425/429 + 5xx → retriable.
 * Other 4xx → terminal (client error in the request itself).
 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
} as const;

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Terminal errors short-circuit immediately.
      if (!isRetriable(err)) throw err;

      // Out of attempts — surface the last error.
      if (attempt >= maxAttempts) throw err;

      opts.onAttempt?.(attempt, err);

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws — but TS wants a value.
  throw lastError;
}

// ---------- classification ----------

function isRetriable(err: unknown): boolean {
  // AbortError: caller cancelled, never retry.
  if (isAbortError(err)) return false;

  // Explicit override: { retriable: false } wins.
  if (typeof err === 'object' && err !== null && 'retriable' in err) {
    return Boolean((err as { retriable?: unknown }).retriable);
  }

  // HTTP status classification (HttpError or anything with a .status field).
  const status = httpStatusOf(err);
  if (status !== undefined) {
    if (status === 401 || status === 403) return false;     // auth dead
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;        // 4xx other → terminal
    return false;
  }

  // No status field → assume network error (TypeError from fetch, etc.).
  // These are typically transient: DNS, connection reset, TLS hiccup.
  return true;
}

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof HttpError) return err.status;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return (err as { name?: unknown }).name === 'AbortError';
  }
  return false;
}

// ---------- timing ----------

/**
 * baseDelayMs * 4^(attempt-1), then ±25% jitter, then clamp at maxDelayMs.
 * attempt is 1-indexed (the attempt that just failed). For default
 * base=1000 / max=16000 the wait sequence is 1s → 4s → 16s, matching the
 * plan ("3 attempts, 1s/4s/16s, jitter").
 *
 * In practice the orchestrator tolerates ~1s + ~4s = ~5s for two retries
 * before resolving, which matches the plan's "<30s under 429" target.
 */
function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(4, attempt - 1);
  const jitterPct = (Math.random() * 0.5) - 0.25; // ±25%
  const withJitter = exponential * (1 + jitterPct);
  return Math.max(0, Math.min(withJitter, maxDelayMs));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
