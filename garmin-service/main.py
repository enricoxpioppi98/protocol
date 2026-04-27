"""
Protocol — Garmin biometrics service.

A single FastAPI endpoint that wraps the community `garminconnect` library.
Deployed to Railway (not Vercel — the auth flow is multi-step and slow on
cold start, which fights serverless timeouts).

Auth: bearer token via `GARMIN_SERVICE_TOKEN` env var, set on Railway and
shared with Vercel. The Next.js server route is the only legitimate caller.

Input: encrypted Garmin password is decrypted server-side in Next.js
*before* this service is called; this service only ever receives a
plaintext password over TLS, scoped to a single request, and never
persists it.
"""

import hashlib
import logging
import os
import threading
from datetime import date as Date
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from garminconnect import (  # type: ignore
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from pydantic import BaseModel, Field

logger = logging.getLogger("protocol.garmin")
logging.basicConfig(level=logging.INFO)

SERVICE_TOKEN = os.environ.get("GARMIN_SERVICE_TOKEN", "")

# Per-user session cache. garth (the lib that garminconnect wraps) does a
# multi-step SSO handshake on every login(); back-to-back fresh logins trip
# Garmin's 429 rate limit. We persist the auth tokens to disk after the first
# successful login and resume from disk on subsequent calls. A short sanity
# request (`get_full_name`) verifies the cached session still works; if it
# doesn't, we delete and re-login.
SESSION_DIR = Path(
    os.environ.get("GARMIN_SESSION_DIR", "/tmp/protocol-garmin-sessions")
)
SESSION_DIR.mkdir(parents=True, exist_ok=True)

# Per-email lock so two concurrent /garmin/today calls for the same user
# don't both attempt a fresh login and stomp each other's session file.
_session_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()


def _lock_for(email: str) -> threading.Lock:
    with _locks_lock:
        lock = _session_locks.get(email)
        if lock is None:
            lock = threading.Lock()
            _session_locks[email] = lock
        return lock


def _session_path(email: str) -> Path:
    digest = hashlib.sha256(email.lower().encode("utf-8")).hexdigest()[:32]
    p = SESSION_DIR / digest
    p.mkdir(exist_ok=True)
    return p


def get_garmin_client(email: str, password: str) -> Garmin:
    """
    Build a Garmin client whose login() reuses (or creates+persists) tokens at
    a per-email tokenstore directory. garminconnect 0.3.x's login(tokenstore=)
    handles the resume-or-fresh-login pattern internally.
    """
    lock = _lock_for(email)
    with lock:
        path = _session_path(email)
        client = Garmin(email=email, password=password)
        try:
            client.login(tokenstore=str(path))
        except Exception:  # noqa: BLE001
            # If a stale tokenstore is corrupting login, wipe and try fresh.
            for f in path.iterdir():
                try:
                    f.unlink()
                except OSError:
                    pass
            client = Garmin(email=email, password=password)
            client.login(tokenstore=str(path))
        logger.info("garmin: logged in (or resumed) for %s***", email[:3])
        return client

app = FastAPI(title="Protocol Garmin Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def require_token(authorization: str = Header(default="")) -> None:
    if not SERVICE_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GARMIN_SERVICE_TOKEN not configured",
        )
    expected = f"Bearer {SERVICE_TOKEN}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid bearer token",
        )


class GarminTodayRequest(BaseModel):
    email: str
    password: str
    date: Date = Field(default_factory=Date.today)


class GarminTodayResponse(BaseModel):
    sleep_score: int | None = None
    sleep_duration_minutes: int | None = None
    hrv_ms: int | None = None
    resting_hr: int | None = None
    stress_avg: int | None = None
    training_load_acute: int | None = None
    training_load_chronic: int | None = None
    raw: dict


@app.get("/health")
def health() -> dict:
    return {"ok": True}


def _fetch_one_day(client: Garmin, target: Date) -> GarminTodayResponse:
    """
    Fetch biometrics for a single date. The community library's stats/sleep/hrv
    calls each return slightly different shapes — we extract the fields
    Protocol needs and stash the unmodified responses under `raw` for debugging.
    """
    iso = target.isoformat()
    raw: dict = {}

    try:
        raw["stats"] = client.get_stats(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_stats(%s) failed: %s", iso, exc)
        raw["stats"] = {}

    try:
        raw["sleep"] = client.get_sleep_data(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_sleep_data(%s) failed: %s", iso, exc)
        raw["sleep"] = {}

    try:
        raw["hrv"] = client.get_hrv_data(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_hrv_data(%s) failed: %s", iso, exc)
        raw["hrv"] = {}

    try:
        raw["training_status"] = client.get_training_status(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_training_status(%s) failed: %s", iso, exc)
        raw["training_status"] = {}

    stats = raw["stats"] or {}
    sleep_obj = (raw["sleep"] or {}).get("dailySleepDTO", {}) or {}
    hrv_summary = (raw["hrv"] or {}).get("hrvSummary", {}) or {}
    ts_obj = raw["training_status"] or {}

    sleep_score = None
    overall_score = sleep_obj.get("sleepScores", {}).get("overall", {})
    if isinstance(overall_score, dict):
        sleep_score = overall_score.get("value")

    sleep_seconds = sleep_obj.get("sleepTimeSeconds")
    sleep_duration_minutes = (
        int(sleep_seconds // 60) if isinstance(sleep_seconds, int) else None
    )

    acute = None
    chronic = None
    if isinstance(ts_obj.get("acuteTrainingLoadDTO"), dict):
        acute = ts_obj["acuteTrainingLoadDTO"].get("acuteTrainingLoad")
        chronic = ts_obj["acuteTrainingLoadDTO"].get("chronicTrainingLoad")

    return GarminTodayResponse(
        sleep_score=sleep_score,
        sleep_duration_minutes=sleep_duration_minutes,
        hrv_ms=hrv_summary.get("lastNightAvg"),
        resting_hr=stats.get("restingHeartRate"),
        stress_avg=stats.get("averageStressLevel"),
        training_load_acute=acute,
        training_load_chronic=chronic,
        raw=raw,
    )


@app.post(
    "/garmin/today",
    response_model=GarminTodayResponse,
    dependencies=[Depends(require_token)],
)
def garmin_today(req: GarminTodayRequest) -> GarminTodayResponse:
    """Fetch biometrics for a single date (default: today)."""
    try:
        client = get_garmin_client(req.email, req.password)
    except GarminConnectAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=f"garmin auth failed: {exc}")
    except GarminConnectTooManyRequestsError as exc:
        raise HTTPException(status_code=429, detail=f"garmin rate limited: {exc}")
    except GarminConnectConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"garmin upstream: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("garmin login failed")
        raise HTTPException(status_code=500, detail=f"unexpected: {exc}")

    return _fetch_one_day(client, req.date)


class GarminRangeRequest(BaseModel):
    email: str
    password: str
    start_date: Date
    end_date: Date

    def date_iter(self):
        d = self.start_date
        while d <= self.end_date:
            yield d
            d = Date.fromordinal(d.toordinal() + 1)


class GarminRangeDay(BaseModel):
    date: Date
    biometrics: GarminTodayResponse


class GarminRangeResponse(BaseModel):
    days: list[GarminRangeDay]


@app.post(
    "/garmin/range",
    response_model=GarminRangeResponse,
    dependencies=[Depends(require_token)],
)
def garmin_range(req: GarminRangeRequest) -> GarminRangeResponse:
    """
    Fetch biometrics for an inclusive date range. Single login (or cached
    session resume) covers the whole range, so backfilling 7 days costs one
    auth handshake and N cheap day-by-day data fetches.

    Range is capped at 31 days to keep the worst-case latency bounded.
    """
    span_days = (req.end_date - req.start_date).days + 1
    if span_days < 1:
        raise HTTPException(status_code=400, detail="end_date < start_date")
    if span_days > 31:
        raise HTTPException(status_code=400, detail="range exceeds 31 days")

    try:
        client = get_garmin_client(req.email, req.password)
    except GarminConnectAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=f"garmin auth failed: {exc}")
    except GarminConnectTooManyRequestsError as exc:
        raise HTTPException(status_code=429, detail=f"garmin rate limited: {exc}")
    except GarminConnectConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"garmin upstream: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("garmin login failed")
        raise HTTPException(status_code=500, detail=f"unexpected: {exc}")

    days: list[GarminRangeDay] = []
    for d in req.date_iter():
        days.append(GarminRangeDay(date=d, biometrics=_fetch_one_day(client, d)))
    return GarminRangeResponse(days=days)
