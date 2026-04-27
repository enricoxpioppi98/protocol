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

import logging
import os
from datetime import date as Date

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


@app.post(
    "/garmin/today",
    response_model=GarminTodayResponse,
    dependencies=[Depends(require_token)],
)
def garmin_today(req: GarminTodayRequest) -> GarminTodayResponse:
    """
    Fetch today's biometrics. The community library's stats/sleep/hrv calls
    each return slightly different shapes — we extract the fields Protocol
    needs and stash the unmodified responses under `raw` for debugging.
    """
    try:
        client = Garmin(req.email, req.password)
        client.login()
    except GarminConnectAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=f"garmin auth failed: {exc}")
    except GarminConnectTooManyRequestsError as exc:
        raise HTTPException(status_code=429, detail=f"garmin rate limited: {exc}")
    except GarminConnectConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"garmin upstream: {exc}")
    except Exception as exc:  # noqa: BLE001 — community lib raises a wide tree
        logger.exception("garmin login failed")
        raise HTTPException(status_code=500, detail=f"unexpected: {exc}")

    iso = req.date.isoformat()
    raw: dict = {}

    # Daily stats: resting heart rate, average stress, total steps, etc.
    try:
        raw["stats"] = client.get_stats(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_stats failed: %s", exc)
        raw["stats"] = {}

    # Sleep summary: score + total sleep seconds.
    try:
        raw["sleep"] = client.get_sleep_data(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_sleep_data failed: %s", exc)
        raw["sleep"] = {}

    # HRV (overnight). The library exposes get_hrv_data on recent versions.
    try:
        raw["hrv"] = client.get_hrv_data(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_hrv_data failed: %s", exc)
        raw["hrv"] = {}

    # Training load — Garmin's "training status" view. May be missing on rest days.
    try:
        raw["training_status"] = client.get_training_status(iso) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_training_status failed: %s", exc)
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

    return GarminTodayResponse(
        sleep_score=sleep_score,
        sleep_duration_minutes=sleep_duration_minutes,
        hrv_ms=hrv_summary.get("lastNightAvg"),
        resting_hr=stats.get("restingHeartRate"),
        stress_avg=stats.get("averageStressLevel"),
        training_load_acute=ts_obj.get("acuteTrainingLoadDTO", {}).get(
            "acuteTrainingLoad"
        )
        if isinstance(ts_obj.get("acuteTrainingLoadDTO"), dict)
        else None,
        training_load_chronic=ts_obj.get("acuteTrainingLoadDTO", {}).get(
            "chronicTrainingLoad"
        )
        if isinstance(ts_obj.get("acuteTrainingLoadDTO"), dict)
        else None,
        raw=raw,
    )
