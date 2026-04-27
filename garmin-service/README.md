# garmin-service

A single-endpoint FastAPI wrapper around the community [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) library. Pulls today's biometrics (sleep score, HRV, RHR, stress, training load) from Garmin Connect.

## Why a separate service

Garmin's auth is multi-step (handshake, MFA negotiation, session cookies) and slow on cold start. Vercel's 10s default timeout fights this. Railway runs a long-lived process that keeps the auth session warm and is free for one user at this scale.

## Local dev

```bash
cd garmin-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export GARMIN_SERVICE_TOKEN=$(openssl rand -hex 32)
uvicorn main:app --reload --port 8787
```

Smoke test:

```bash
curl http://localhost:8787/health
# {"ok": true}

curl -X POST http://localhost:8787/garmin/today \
  -H "Authorization: Bearer $GARMIN_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "...", "password": "...", "date": "2026-04-26"}'
```

## Deploy to Railway

1. `railway init` (or push this directory to a GitHub repo and connect it as a Railway project).
2. Set env: `GARMIN_SERVICE_TOKEN=<32-hex-bytes>`.
3. Set the same token in Vercel as `GARMIN_SERVICE_TOKEN` and the Railway URL as `GARMIN_SERVICE_URL`.

## Security model

- The Next.js Vercel route is the only legitimate caller. It holds the bearer token and decrypts the user's Garmin password (AES-256-GCM with `GARMIN_ENC_KEY`) right before calling this service.
- This service receives the plaintext password over TLS, scoped to a single request, and never persists it.
- The service has no database. It's stateless.
- CORS is open because the only client should be a server-to-server caller; locking down origins doesn't help when the bearer token is the actual gate.
