# Flighty Clone — Architecture

## Project Overview

A single-user iOS flight tracking app replicating core Flighty functionality. Built with React Native (Expo) for fast iteration. No multi-tenancy, no auth complexity — the device is the user.

---

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile | React Native + Expo SDK 51 | Fast iteration, Claude Code compatibility, OTA updates |
| Language | TypeScript (strict) | Type safety for API response shapes |
| Navigation | Expo Router (file-based) | Matches Next.js conventions, easy deep linking |
| State | Zustand | Lightweight, no boilerplate, persists with AsyncStorage |
| Backend/DB | Supabase | Postgres + realtime + edge functions, free tier sufficient |
| Flight Data | AviationStack API | Free tier 500 calls/month; upgrade to AeroAPI if needed |
| Notifications | Expo Push Notifications + Supabase Edge Functions | Cron-based polling, no always-on server required |
| Maps | React Native Maps (MapKit on iOS) | Native performance for flight path rendering |
| Styling | NativeWind (Tailwind for RN) | Consistent design tokens |

---

## Directory Structure

```
flighty-clone/
├── app/                        # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx           # Home / upcoming flights
│   │   ├── search.tsx          # Flight search
│   │   └── trips.tsx           # Trip management
│   ├── flight/[id].tsx         # Flight detail screen
│   ├── trip/[id].tsx           # Trip detail screen
│   └── _layout.tsx
├── components/
│   ├── FlightCard.tsx
│   ├── FlightMap.tsx
│   ├── StatusBadge.tsx
│   ├── TripCard.tsx
│   └── NotificationBanner.tsx
├── lib/
│   ├── api/
│   │   ├── aviationstack.ts    # Flight data fetching
│   │   └── supabase.ts         # DB client
│   ├── store/
│   │   ├── flightStore.ts      # Tracked flights state
│   │   └── tripStore.ts        # Trips state
│   ├── notifications.ts        # Push token registration + handlers
│   └── utils.ts
├── supabase/
│   ├── migrations/             # SQL schema
│   └── functions/
│       └── poll-flights/       # Edge function for background polling
├── CLAUDE.md
└── ARCHITECTURE.md
```

---

## Data Models

### Flight (from AviationStack)

```typescript
interface Flight {
  id: string;                   // {iata_code}-{date}-{flight_number}
  flightNumber: string;         // e.g. "AA 447"
  airline: string;
  origin: Airport;
  destination: Airport;
  scheduledDeparture: string;   // ISO 8601
  scheduledArrival: string;
  estimatedDeparture?: string;
  estimatedArrival?: string;
  actualDeparture?: string;
  actualArrival?: string;
  status: FlightStatus;
  gate?: string;
  terminal?: string;
  aircraft?: string;
  delayMinutes?: number;
  livePosition?: LivePosition;
}

type FlightStatus =
  | 'scheduled'
  | 'active'
  | 'landed'
  | 'cancelled'
  | 'diverted'
  | 'unknown';

interface Airport {
  iata: string;
  name: string;
  city: string;
  timezone: string;
  lat: number;
  lon: number;
}

interface LivePosition {
  lat: number;
  lon: number;
  altitude: number;
  speed: number;
  heading: number;
  updatedAt: string;
}
```

### Trip (stored in Supabase)

```typescript
interface Trip {
  id: string;
  name: string;
  flights: TrackedFlight[];
  createdAt: string;
  updatedAt: string;
}

interface TrackedFlight {
  id: string;
  tripId?: string;
  flightNumber: string;
  date: string;                 // YYYY-MM-DD
  addedAt: string;
  notificationsEnabled: boolean;
  lastKnownStatus: FlightStatus;
  cachedData?: Flight;
  cachedAt?: string;
}
```

### Supabase Schema

```sql
-- tracked_flights: persists which flights the user is watching
create table tracked_flights (
  id uuid primary key default gen_random_uuid(),
  flight_number text not null,
  flight_date date not null,
  trip_id uuid references trips(id) on delete set null,
  notifications_enabled boolean default true,
  last_known_status text default 'scheduled',
  cached_data jsonb,
  cached_at timestamptz,
  created_at timestamptz default now(),
  unique(flight_number, flight_date)
);

-- trips: grouping container
create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- push_tokens: device push token storage
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  platform text not null,       -- 'ios' | 'android'
  registered_at timestamptz default now()
);
```

---

## Screen Inventory

### Home Tab (`/`)

See **Home Tab** section below for full spec.

### Search (`/search`)

See **Search Feature** section below for full spec.

### Flight Detail (`/flight/[id]`)

See **Flight Detail** section below for full spec.

### Trips (`/trips`)

See **Trips & Trip Detail** section below for full spec.

### Trip Detail (`/trip/[id]`)

See **Trips & Trip Detail** section below for full spec.

---

## API Integration

### AviationStack

Base URL: `https://api.aviationstack.com/v1`

Key endpoints:
- `GET /flights?flight_iata={number}&flight_date={YYYY-MM-DD}` — current flight status
- `GET /airports?iata_code={code}` — airport details (cache locally)
- `GET /airlines?iata_code={code}` — airline details (cache locally)

Rate limit strategy:
- Free tier: 500 calls/month
- Cache all responses in Supabase `tracked_flights.cached_data`
- Cache TTL: 3 minutes for active flights, 30 minutes for scheduled
- Never poll more than once per 3 minutes per flight
- On app foreground: refresh only flights departing within 24 hours

Upgrade path: swap `aviationstack.ts` client for AeroAPI client — same interface, better live data.

### Response Normalization

All API responses are normalized to internal `Flight` type in `lib/api/aviationstack.ts` before reaching any component or store. Components never consume raw API shapes.

---

## Notification Architecture

### Flow

```
Supabase Edge Function (cron, every 5 min)
  → Query tracked_flights WHERE notifications_enabled = true
     AND flight_date >= today AND last_known_status != 'landed'
  → For each: call AviationStack API
  → Compare new status/delay to cached
  → If changed: send Expo Push Notification
  → Update cached_data + last_known_status
```

### Notification Types

| Trigger | Message |
|---|---|
| Delay > 15 min detected | "AA 447 delayed 25 min — now departs 3:45 PM" |
| Gate change | "AA 447 gate changed: B12 → C4" |
| Boarding (T-30 est) | "AA 447 boarding at B12 in ~30 min" |
| Departure confirmed | "AA 447 departed ORD" |
| Landing confirmed | "AA 447 landed at JFK" |
| Cancellation | "AA 447 cancelled" |

### Setup Steps (manual, one-time)
1. `npx expo install expo-notifications`
2. Register push token on app launch → save to `push_tokens` table
3. Deploy Supabase Edge Function with `EXPO_PUSH_TOKEN` and `AVIATIONSTACK_API_KEY` env vars
4. Set cron schedule in Supabase Dashboard → Edge Functions → Schedules

---

## State Management

### Zustand Stores

**flightStore**
```typescript
{
  trackedFlights: TrackedFlight[];
  addFlight: (flightNumber: string, date: string) => Promise<void>;
  removeFlight: (id: string) => Promise<void>;
  refreshFlight: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  toggleNotifications: (id: string) => Promise<void>;
}
```

**tripStore**
```typescript
{
  trips: Trip[];
  createTrip: (name: string) => Promise<Trip>;
  deleteTrip: (id: string) => Promise<void>;
  renameTrip: (id: string, name: string) => Promise<void>;
  addFlightToTrip: (tripId: string, flightId: string) => Promise<void>;
  removeFlightFromTrip: (tripId: string, flightId: string) => Promise<void>;
}
```

Persistence: both stores hydrate from Supabase on app launch and write through on every mutation.

---

## Map Implementation

- Use `react-native-maps` with `PROVIDER_DEFAULT` (MapKit on iOS)
- Flight path: great circle arc rendered as `Polyline` using waypoints computed from origin/destination coordinates
- Aircraft position: `Marker` at `livePosition` coordinates, rotated to `heading`
- Only render map when flight status is `active` or within 2 hours of departure
- AviationStack free tier does NOT include live position — implement map arc as static great circle; live dot requires AeroAPI upgrade

---

## Environment Variables

```
# .env.local
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
AVIATIONSTACK_API_KEY=          # server-side only (Edge Function), never in client bundle
```

Never expose `AVIATIONSTACK_API_KEY` in the client. All API calls to AviationStack go through Supabase Edge Functions.

---

## Build & Run

```bash
npx create-expo-app flighty-clone --template blank-typescript
cd flighty-clone
npx expo install expo-router expo-notifications react-native-maps nativewind zustand @supabase/supabase-js
npx expo start
```

Supabase:
```bash
npx supabase init
npx supabase db push
npx supabase functions deploy poll-flights
```

---

## Known Constraints & Upgrade Paths

| Constraint | Current | Upgrade |
|---|---|---|
| Live flight position | Not available (AviationStack free) | AeroAPI `$0.0025/call` |
| Seat maps | Not implemented | SeatGuru unofficial API or Aerodatabox |
| Historical flights | Not implemented | AviationStack paid tier |
| Background fetch | Push only (server polls) | Expo BackgroundFetch for on-device polling |
| Offline mode | Cached data shown stale | Add offline indicator + last-updated timestamp |

---

## Sharing Features

Recipients (friends/family) can view a live flight tracker page in their browser — no app required. The owner generates a share link from the app; the link resolves to a public web page hosted via Supabase Edge Function or a lightweight Next.js page.

### Share Link Model

```sql
-- share_links: one row per shared flight or trip
create table share_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null default encode(gen_random_bytes(12), 'base64url'),
  type text not null check (type in ('flight', 'trip')),
  flight_id uuid references tracked_flights(id) on delete cascade,
  trip_id uuid references trips(id) on delete cascade,
  label text,                        -- optional custom label e.g. "My NYC Trip"
  expires_at timestamptz,            -- null = no expiry
  view_count integer default 0,
  created_at timestamptz default now()
);
```

Constraints:
- `token` is a 12-byte URL-safe base64 string (16 chars) — short enough to share via SMS
- Exactly one of `flight_id` or `trip_id` must be non-null (enforce via check constraint or app logic)
- RLS policy: `share_links` is readable by anyone with the token; writable only by the owner (anon key with service role on insert)

### Share URL Format

```
https://<your-domain>/track/<token>
```

Examples:
- `https://myflights.app/track/aB3xZ9kQ2mPw` — single flight
- `https://myflights.app/track/tR7nK4yL8vXc` — full trip itinerary

### Recipient Web Page

A server-rendered page (Next.js or Supabase Edge Function returning HTML) at `/track/[token]`:

**Single Flight View:**
- Airline + flight number + route
- Live status badge
- Departure / arrival times (scheduled vs. actual, recipient's local timezone)
- Gate + terminal
- Live map with aircraft position (auto-refreshes every 60s via client-side polling)
- Delay callout if delayed > 15 min
- No login required, no app required

**Trip View:**
- Trip name + owner label
- All flights in the trip as a vertical timeline
- Each flight card expandable to show full detail
- Active/in-air flights highlighted at top

Page auto-refreshes flight data every 60s via a public `GET /api/track/[token]` endpoint that queries Supabase and returns normalized flight data. Recipient never touches AeroAPI directly.

### App-Side Sharing UI

**Entry points:**
- Flight Detail screen: share icon (top-right) → share sheet
- Trip Detail screen: share icon → share sheet

**Share Sheet flow:**
1. Tap share icon
2. App calls `createShareLink(flightId | tripId)` → inserts row in `share_links`, returns URL
3. iOS native share sheet opens with the URL pre-populated
4. User sends via iMessage, WhatsApp, email, etc.

**Share management screen** (`/settings/shares`):
- List of active share links (label, type, view count, expiry)
- Swipe to revoke (deletes row → link returns 404)
- Toggle expiry: 24h / 7 days / never

### Zustand Store Addition

```typescript
// shareStore.ts
{
  shareLinks: ShareLink[];
  createShareLink: (opts: {
    type: 'flight' | 'trip';
    id: string;
    label?: string;
    expiresIn?: '24h' | '7d' | null;
  }) => Promise<string>;            // returns URL
  revokeShareLink: (id: string) => Promise<void>;
  fetchShareLinks: () => Promise<void>;
}
```

### Public API Endpoint

Supabase Edge Function: `GET /functions/v1/track?token=<token>`

```
1. Lookup share_links WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())
2. If not found → 404
3. Increment view_count
4. If type = 'flight': fetch tracked_flights + cached_data for that flight
5. If type = 'trip': fetch all tracked_flights in the trip + their cached_data
6. Return normalized JSON (same shape as internal Flight type)
```

This endpoint has no auth. Rate-limit it to 60 req/min per token via Supabase's built-in rate limiting or a simple Redis counter.

### Directory Structure Additions

```
app/
├── settings/
│   └── shares.tsx              # Manage active share links
├── track/
│   └── [token].tsx             # Recipient web view (if using Expo web)

lib/
├── store/
│   └── shareStore.ts
├── api/
│   └── shares.ts               # createShareLink, revokeShareLink, fetchShareLinks

supabase/
├── migrations/
│   └── 003_share_links.sql
└── functions/
    └── track/                  # Public read endpoint for recipients
```

### Environment Variable Addition

```
SHARE_BASE_URL=https://myflights.app   # root for share link generation
```

If not deploying a separate web host, use Expo Web (`npx expo export --platform web`) deployed to Vercel or Netlify. The `/track/[token]` route renders the recipient view using the same React Native Web components.

### Security Notes

- Tokens are unguessable (96 bits of entropy) but not secret — treat links as "anyone with the link can view"
- No PII is exposed beyond flight number, route, and status
- Revoking a link immediately returns 404 for all subsequent requests
- `expires_at` is enforced server-side; client cannot extend it

---

## Trips & Trip Detail

### What Flighty Actually Does

Flighty does not have a robust Trips feature. Flights in Flighty are all just grouped together as a long list — there is no explicit user-created trip container. Consecutive flights that share the same routing within a short time window are visually linked on the home tab with connector lines, but this is automatic and implicit. There is no dedicated Trips screen in Flighty. Users have complained about this limitation; one App Store reviewer noted they wished they could save individual trips to review past itineraries as a unit.

This app intentionally does better. Trips are explicit, user-named containers that the user manages. This section specs both the Trips list screen and the Trip Detail screen.

---

### Trips List (`/trips`)

#### Overview

A scrollable list of all trips, both upcoming and past. Each trip is a named container holding one or more flights. Trips are sorted by the departure date of the earliest flight in the trip — upcoming trips first (soonest at top), past trips below with a divider.

#### Trip Card

```
┌─────────────────────────────────────────────────────┐
│  Chicago → London                   [Active ●]       │
│  Mar 20 – Mar 28                                     │
│                                                      │
│  [AA logo] [BA logo]    3 flights  ·  8 days         │
│                                                      │
│  ⚡ 1 tight connection  ·  ⚠ AA 447 delayed 25m      │
└─────────────────────────────────────────────────────┘
```

- **Trip name** (user-set, e.g. "Chicago → London" or "NYC Work Trip") — bold, top-left
- **Status badge** — top-right: "Active" (green pulse) if any flight in the trip is currently airborne; "Today" if a flight departs today; "In 3 days" countdown; "Completed" (gray) for past trips
- **Date range** — formatted as "Mar 20 – Mar 28"
- **Airline logos** — small logo icons for each unique airline in the trip, stacked horizontally (max 3 visible, "+N" overflow label)
- **Flight count + duration** — "3 flights · 8 days"
- **Alert strip** — if any flight has an active alert (delay, gate change, tight connection), a single-line summary appears at the bottom of the card in amber/red

#### Trip States

| State | Badge | Card Treatment |
|---|---|---|
| Future, >7 days | "In N days" gray | Normal |
| Future, ≤7 days | "In N days" blue | Slightly elevated shadow |
| Active today | "Today" blue | Elevated, border highlight |
| In air (any leg) | "Active ●" green pulse | Top of list, prominent |
| Completed | "Completed" gray | Muted opacity, below divider |

#### Empty State

- No trips yet: centered illustration + "No trips yet" + "Tap + to create your first trip"
- Only past trips: upcoming section shows "No upcoming trips" before past section

#### Navigation Header

- Title: "Trips"
- Right button: "+" → Create Trip sheet

#### Create Trip Sheet

Bottom sheet with a single text field: "Trip name". Pre-filled suggestion based on origin/destination of the first flight added (e.g. "Chicago → London"). "Create" button confirms. The trip is created empty; flights are added from within the Trip Detail screen or by associating flights from the Flight Detail screen.

#### Swipe Actions

- Swipe left → "Delete" (red, with confirmation: "Delete trip? Flights will not be deleted.")
- Swipe right → "Rename"

---

### Trip Detail (`/trip/[id]`)

#### Overview

Full-screen view of a single trip. The top portion shows a map of the entire trip's route — all flight arcs rendered together as a connected journey. Below is a vertical timeline of all flights in the trip, with connections and layovers shown inline. The screen scrolls as one continuous view with the map shrinking as the user scrolls down (parallax/sticky header pattern).

---

#### Map Header

Full-bleed map at the top showing the complete multi-leg route:

- Each flight leg rendered as a great circle arc
- Airport markers at every stop (origin, connection points, final destination), labeled with IATA code
- Arcs are colored by status:
  - Completed legs: faded/dashed gray
  - Upcoming legs: solid white
  - Currently active leg: bright color + animated aircraft marker at current position
- Map is non-interactive (same as home tab ambient map). Tapping it opens a full-screen interactive map sheet.
- Map height collapses from ~40% of screen to a sticky ~120pt header as the user scrolls down

---

#### Trip Header (below map, above timeline)

```
NYC Work Trip
Apr 7 – Apr 11  ·  4 flights  ·  3,842 mi total
[AA logo][DL logo]  ·  In 5 days
```

- Trip name (editable on tap — inline rename)
- Date range, flight count, total distance
- Airline logos
- Countdown or status badge

---

#### Flight Timeline

The core of the Trip Detail screen. All flights rendered vertically in chronological order, connected by visual elements representing ground time between legs.

**Flight row:**

```
┌─────────────────────────────────────────────────────┐
│ [AA logo]  AA 447  ORD → LHR          [On Time ✓]   │
│            Thu Mar 20                                │
│            9:10 PM  →  11:45 AM +1                  │
│            T3 · Gate H7    T5 · Gate A22             │
│            Boeing 777-300ER  ·  Seat 14A             │
└─────────────────────────────────────────────────────┘
```

Tap → pushes Flight Detail screen for that flight.

**Connection node (between two flights with ground time 0–8h):**

```
        │
        │  LHR  ·  2h 05m
        │  ⚡ Tight  [tap for Connection Assistant]
        │
```

- Vertical line connecting the two flight cards
- Airport IATA + ground time
- Connection risk badge: Relaxed (green) / Normal (blue) / Tight (amber) / Risky (red)
- Tap badge → Connection Assistant sheet (see below)

**Layover node (ground time 8–24h):**

```
        │
        ╠══ LHR  ·  10h 30m layover
        │   London, United Kingdom  🇬🇧
        │
```

- Wider/different visual treatment to distinguish from connection
- City name + country flag
- "Layover" label

**Overnight node (ground time >24h between sequential flights in the trip):**

```
        │
        ╠══ LHR  ·  2 nights
        │   London, United Kingdom  🇬🇧
        │
```

- Labeled "N nights" instead of duration

---

#### Connection Assistant Sheet

Triggered by tapping the connection risk badge in the timeline. Full-height bottom sheet.

```
LHR Connection
AA 447 arrives  →  BA 117 departs
11:45 AM           1:50 PM
──────────────────────────────────
Available time:     2h 05m
Minimum required:   1h 15m  (T5 → T5, domestic)
Buffer:             50m

Risk:  ⚡ Tight

───────────────────────────────
Why Tight?
Your connection meets the Minimum Connection Time
(MCT) but leaves limited buffer for delays. A delay
of 51+ minutes to AA 447 would put this connection
at risk.

───────────────────────────────
If AA 447 is delayed...
  +30 min delay  →  Still Tight    (20m buffer)
  +51 min delay  →  At Risk        (0m buffer)
  +60 min delay  →  Miss likely

───────────────────────────────
Both gates are in Terminal 5.
Walking time: ~12 min (no security re-screen)
```

Fields:
- Inbound flight arrival time + outbound departure time
- Available connection time
- MCT for this airport/terminal combination (sourced from OAG/IATA data via AeroAPI)
- Buffer (available − MCT)
- Risk classification with explanation
- Delay sensitivity table: at what inbound delay does this connection become risky/missed
- Walking context: same/different terminal, security re-screen required, estimated walking time
- Real-time update: if inbound is currently delayed, the sheet recalculates and highlights the new risk level

The Connection Assistant uses connection time data and real-time mapping to help travelers navigate tight connecting itineraries, with designations for Relaxed, Normal, Tight, or Risky connections. It tracks both the inbound and outbound flights in real time and alerts the user if the connection is at risk.

**Connection risk thresholds (computed):**
- **Relaxed**: available time ≥ 2× MCT
- **Normal**: available time ≥ 1.5× MCT and < 2× MCT
- **Tight**: available time ≥ MCT and < 1.5× MCT
- **Risky**: available time < MCT, or current delay puts available time below MCT

---

#### Trip Summary Section

Below the timeline, a summary card for the whole trip:

```
Trip Summary
────────────────────────────────
Total distance        3,842 mi
Total flight time     9h 48m air
Airports visited      3  (ORD, LHR, CDG)
Airlines              2  (AA, BA)
Time zones crossed    +6h
────────────────────────────────
Delays so far         +25m  (AA 447)
Connection risk       1 tight (LHR)
```

Computed from all flights in the trip. Updated in real time.

---

#### Trip Toolbar

Persistent toolbar at the bottom of the Trip Detail screen:

| Button | Action |
|---|---|
| Add Flight | Open search to add a flight to this trip |
| Share Trip | Generate share link for the whole trip |
| Rename | Inline rename the trip |
| Delete | Delete trip (flights remain, just disassociated) |

---

#### Component Structure

```
components/
├── trips/
│   ├── TripsList.tsx               # Scrollable trip card list
│   ├── TripCard.tsx                # Summary card with status + alerts
│   ├── CreateTripSheet.tsx         # Name input bottom sheet
│   ├── TripDetailScreen.tsx        # Root: map header + timeline
│   ├── TripRouteMap.tsx            # Multi-leg arc map header
│   ├── TripHeader.tsx              # Name, dates, distance, airlines
│   ├── FlightTimeline.tsx          # Vertical list of flight rows + nodes
│   ├── TimelineFlightRow.tsx       # Individual flight in the timeline
│   ├── ConnectionNode.tsx          # Connection info + risk badge between flights
│   ├── LayoverNode.tsx             # Layover info node
│   ├── ConnectionAssistantSheet.tsx # Full connection detail bottom sheet
│   ├── DelayImpactTable.tsx        # "If delayed N min" table
│   └── TripSummaryCard.tsx         # Aggregate stats at bottom
```

---

#### Zustand Store

```typescript
// tripStore.ts
{
  trips: Trip[];
  createTrip: (name: string) => Promise<Trip>;
  deleteTrip: (id: string) => Promise<void>;
  renameTrip: (id: string, name: string) => Promise<void>;
  addFlightToTrip: (tripId: string, flightId: string) => Promise<void>;
  removeFlightFromTrip: (tripId: string, flightId: string) => Promise<void>;
  getConnectionRisk: (
    inboundFlightId: string,
    outboundFlightId: string
  ) => ConnectionRisk;
}

type ConnectionRisk = {
  label: 'relaxed' | 'normal' | 'tight' | 'risky';
  availableMinutes: number;
  mctMinutes: number;
  bufferMinutes: number;
  requiresSecurityRescreen: boolean;
  estimatedWalkMinutes: number;
  delayThresholds: { delayMinutes: number; newLabel: ConnectionRisk['label'] }[];
}
```

---

#### Layover / Connection Classification Logic

Implemented client-side in `lib/connections.ts`. Based on scheduled times stored in `tracked_flights`, not real-time data (real-time recalculation happens in the Connection Assistant sheet when opened).

```typescript
function classifyGroundTime(
  arrivalScheduled: Date,
  departureScheduled: Date
): 'connection' | 'layover' | 'overnight' {
  const minutes = differenceInMinutes(departureScheduled, arrivalScheduled);
  if (minutes <= 480) return 'connection';       // 0–8h
  if (minutes <= 1440) return 'layover';         // 8–24h
  return 'overnight';                            // >24h
}
```

Flighty defines a connection as two back-to-back flights through the same city with ground time between 0 and 8 hours. A layover is ground time between 8 and 24 hours. A roundtrip is a departure and return to the same airport within 24 hours. These definitions govern both the visual treatment in the timeline and how stats are counted.

---

## Flight Detail

### Overview

The Flight Detail screen is the most information-dense screen in the app. The top three-quarters of the screen is dominated by a full-bleed interactive map. Detailed flight data is presented in a bottom sheet that peeks up from the bottom of the screen. The sheet has three snap points: collapsed (map dominant, ~25% sheet), half-expanded (~50%), and nearly full-screen. A quick swipe up snaps to the next position with haptic feedback. Beyond the third snap point, the sheet scrolls freely through a long list of data sections.

Unlike the home tab map (ambient, non-interactive), this map is fully interactive — the user can pan, zoom, and tap airport markers.

---

### Map Layer (Top Section)

Identical rendering approach to the home tab background map but fully interactive and persistent regardless of flight status.

**All flight states:**
- Great circle arc from origin to destination
- Airport markers at both ends (IATA label + dot)
- Aircraft marker at current or last-known position, rotated to heading

**Active (in-air) additions:**
- Aircraft marker animates in real time (60s poll)
- Flown arc segment faded/dashed, remaining arc solid
- Altitude and ground speed shown in a small floating label near the aircraft marker
- Tapping the aircraft marker shows a popover: tail number, altitude, speed, heading

**On the tarmac (taxi state):**
- Airport map zooms in to show taxiways if available
- Aircraft position updates on the ground

**Share button:** top-right corner of the map — opens the share link creation sheet.

**Notification bell:** top-left or alongside share — toggles all notifications for this flight on/off with haptic confirmation.

---

### Bottom Sheet — Snap Point 1 (Collapsed, default on open)

Visible above the map fold:

```
┌──────────────────────────────────────────────────────┐
│  ────  (drag handle)                                  │
│                                                       │
│  AA 447  ·  Thu Mar 20          [On Time ●]           │
│  American Airlines                                    │
│                                                       │
│   ORD  ──────────────●──────────  LHR                 │
│   9:10 PM                         11:45 AM +1         │
│   T3 · Gate H7                    T5 · Gate A22       │
│                                                       │
│   Seat 14A  ·  XYZABC  ·  Boeing 777-300ER           │
└──────────────────────────────────────────────────────┘
```

- Drag handle at top
- Flight number + date + status badge
- Route with departure/arrival times and gates
- Seat, confirmation code, aircraft type on one line
- If delayed: scheduled time struck through, new time in amber below

---

### Bottom Sheet — Snap Point 2 (Half-expanded)

Adds below the snap-1 content:

**Detailed Timetable**

Three columns: **Depart**, **Arrive**, **Totals**

Each column shows:
- Scheduled time
- Estimated / Actual time (color-coded: green = early or on time, amber = slightly late, red = significantly late)
- Gate-out / wheels-off / wheels-on / gate-in times when available (taxi times)

```
           Depart          Arrive         Totals
Sched      9:10 PM         11:45 AM +1    8h 35m
Actual     9:06 PM ✓       11:38 AM ✓     Air: 8h 22m
Gate-Out   9:06 PM         Gate-In: 11:44 AM
Wheels-Off 9:22 PM         Wheels-On: 11:36 AM
                                          Taxi: 6m / 8m
```

**Good to Know**

Informational callouts relevant to the trip:
- Timezone delta: "LHR is 6 hours ahead of ORD"
- DST notice if a daylight savings change occurs during or around the flight
- Overnight flight indicator if the flight crosses midnight

---

### Bottom Sheet — Snap Point 3 / Scroll (Full data)

All sections below scroll freely once the sheet is at full height. Sections are visually separated by dividers. Order matches Flighty's priority: most time-sensitive information first.

---

#### Section: Delay Intel

Only shown when a delay is detected or predicted.

- Delay reason label: "Late Arriving Aircraft", "ATC Ground Stop", "Weather — ORD", "Crew Availability", etc.
- Source: FAA ATCSCC data or AeroAPI delay codes mapped to human-readable strings
- Predicted vs. confirmed flag
- If late aircraft: shows the inbound flight's tail number, current location, and ETA to the gate

---

#### Section: Where's My Plane

Tracks the aircraft (by tail number) for the 25 hours prior to departure. Shows the aircraft's recent flight history — the legs it flew today before arriving at the departure gate.

```
N123AA  ·  Boeing 777-300ER

  DFW → ORD   Landed 6:42 PM  ✓ On Time     [your flight's inbound]
  LAX → DFW   Landed 2:15 PM  ✓ On Time
  ORD → LAX   Landed 10:50 AM  ⚠ +22 min
```

- Each row: origin → destination, actual landing time, on-time status
- The topmost row is the direct inbound to the user's departure airport
- If the inbound is late, the row is highlighted in amber with a "May cause delay" warning
- Only visible when tail number has been assigned (typically T-24h or sooner)

---

#### Section: Arrival Forecast

Shows how the particular route performed over the past 60 days. Displays at what percentage the flight was early, on time, or late — including dreadfully late at 45+ minutes. Also shows if the route was cancelled or diverted.

Visual: horizontal stacked bar or column chart with labeled segments:
- Early (green)
- On Time (green)
- Late <15min (yellow)
- Late 15–45min (amber)
- Late 45min+ (red)
- Cancelled (gray)
- Diverted (purple)

Subtext: "Based on 58 operated flights in the past 60 days"

---

#### Section: Aircraft

Shown once a tail number is assigned. Two sub-sections:

**This Aircraft (tail number)**
- Tail number (e.g. N123AA)
- Aircraft type (Boeing 777-300ER)
- Age: "12 years old · First flight Apr 2013"
- "You've flown this tail before" callout if applicable (cross-referenced against flight history)
- Interior configuration if known (seat layout class)

**Aircraft Type Info**
- Generic facts about the aircraft model
- Cruising speed, range, typical capacity
- Small silhouette illustration of the aircraft type

---

#### Section: Booking Details (User-Editable)

Fields the user can tap to edit inline:
- Seat number (with aisle/middle/window/exit row selector)
- Confirmation / booking code
- Notes (free text)
- Fare class (optional)

These are stored locally in `tracked_flights` and never sent anywhere.

---

#### Section: Airport Info

Two sub-cards side by side (or stacked on smaller screens): **Origin** and **Destination**

Each card:
- Airport name + IATA code
- City, country + flag
- Terminal assigned to this flight
- Gate assigned to this flight (with "Changed" badge if it changed)
- Local time (live clock)
- Weather: current conditions + temperature + icon (from OpenWeatherMap)
- Link: "View airport map" → opens terminal map in a sheet (SVG or web view of airport diagram)

---

#### Section: Alternatives

"Need to change flights?" — shows other flights operating the same route on the same day.

- List of nonstop alternatives, sorted by departure time
- Each row: airline logo, flight number, departure time, arrival time, status
- Tap → search result detail for that flight (not auto-added; user taps "Track" to add)

Useful when a flight is cancelled or significantly delayed and the user needs to find a rebooking option fast.

---

#### Section: Airline Contact

Quick-tap links:
- Phone number (opens dialer)
- Website (opens in-app browser)
- Twitter/X handle (opens app or web)
- "Status line" phone number if different from main line

---

#### Section: My History on This Route

List of all the user's past flights on the same origin–destination pair (regardless of airline), sorted most recent first. Each row shows: date, airline + flight number, aircraft, on-time status, duration. Tap → that past flight's detail.

Summary stat above the list: "You've flown ORD → LHR 4 times"

---

#### Section: Record of Changes

Timestamped log of every change detected for this flight:
```
Mar 20, 2:14 PM   Gate changed H5 → H7
Mar 20, 11:30 AM  Delay updated: +25 min
Mar 20, 8:00 AM   Tail number assigned: N123AA
Mar 19, 6:00 PM   Flight plan filed
```

Most recent change at top. Each row has a type icon (gate, clock, plane, document).

---

### Toolbar (Bottom of Screen)

A persistent toolbar docked at the bottom of the screen (below the sheet, above the home indicator):

| Button | Action |
|---|---|
| Share | Open share link creation sheet |
| Add to Trip | Associate flight with a trip (picker sheet) |
| Notify | Toggle all notifications for this flight |
| Delete | Remove flight from tracking (with confirmation) |

On iOS this maps cleanly to a `UIToolbar` equivalent — four icon buttons with labels.

---

### States by Flight Phase

| Phase | Map | Sheet Default | Key Sections Shown |
|---|---|---|---|
| Far future (>7 days) | Static arc | Snap 1 | Booking details, Airline contact |
| Upcoming (<7 days) | Static arc | Snap 1 | Good to Know, Arrival Forecast |
| Day-of pre-departure | Static arc + gate highlighted | Snap 2 | Detailed Timetable, Where's My Plane, Delay Intel |
| Boarding / Taxi | Airport zoom | Snap 2 | Timetable with gate-out time |
| In Air | Live aircraft position | Snap 1 (map dominant) | Live timetable, Aircraft, Delay Intel |
| Landed | Static final position | Snap 2 | Full timetable with actuals, Baggage claim |
| Cancelled | Static arc, muted | Snap 2 | Delay Intel (cancellation reason), Alternatives |

---

### Component Structure

```
components/
├── flight-detail/
│   ├── FlightDetailScreen.tsx          # Root: map + sheet layers
│   ├── FlightDetailMap.tsx             # Interactive map (extends LiveBackgroundMap)
│   ├── AircraftPositionPopover.tsx     # Tap-on-aircraft info bubble
│   ├── FlightDetailSheet.tsx           # Bottom sheet with 3 snap points
│   ├── SheetHeader.tsx                 # Route, times, gates, seat — snap 1 content
│   ├── DetailedTimetable.tsx           # Depart/Arrive/Totals table
│   ├── GoodToKnow.tsx                  # Timezone + DST callouts
│   ├── DelayIntel.tsx                  # Delay reason + source
│   ├── WhereIsMyPlane.tsx              # Inbound aircraft history
│   ├── ArrivalForecast.tsx             # 60-day on-time chart
│   ├── AircraftSection.tsx             # Tail number + type info
│   ├── BookingDetails.tsx              # Editable seat/code/notes
│   ├── AirportInfoCard.tsx             # Weather + gate + terminal
│   ├── AlternativeFlights.tsx          # Same-route alternatives
│   ├── AirlineContact.tsx              # Phone/web/social links
│   ├── RouteHistory.tsx                # Past flights on this route
│   ├── RecordOfChanges.tsx             # Change log timeline
│   └── FlightDetailToolbar.tsx         # Share/Trip/Notify/Delete
```

---

## Home Tab ("My Flights")

### Overview

The home tab is a vertically scrolling list of the user's tracked flights, labeled "My Flights" in the navigation header. It is the first screen the user sees on every launch. The list is sorted chronologically by scheduled departure. A persistent search bar sits at the top. There are no section headers by default — flights are displayed as a continuous stream of cards, with visual separators only when the temporal context shifts (e.g. past vs. upcoming).

---

### List Structure

Flights are grouped into two implicit sections with no visible header labels:

**Upcoming / Active** — flights departing in the future or currently in the air. Sorted ascending by scheduled departure (soonest first).

**Past** — flights that have landed. Sorted descending (most recent first). Shown below upcoming, visually de-emphasized (reduced opacity or muted color palette). A subtle divider line or "Past Flights" pill separator marks the boundary.

If there are no upcoming flights, the list shows an empty state with a prompt to add a flight.

---

### Flight Card

Each card in the list represents one flight. Cards for the same trip are visually connected — they share a vertical connector line between them (a thin line, same color as the card border, running from the bottom of one card to the top of the next) to indicate they are part of a sequence.

**Card anatomy:**

```
┌─────────────────────────────────────────────────────┐
│ [Airline Logo]  AA 447                  [Status Badge]│
│                 American Airlines                     │
│                                                       │
│  ORD                    →               LHR           │
│  Chicago O'Hare              London Heathrow          │
│                                                       │
│  9:10 PM                               11:45 AM +1    │
│  Terminal 3 · Gate H7         Terminal 5 · Gate A22   │
│                                                       │
│  ──────────────────────────────────────────────      │
│  Boeing 777-300ER · Seat 14A · 8h 35m                │
└─────────────────────────────────────────────────────┘
```

**Top row:**
- Airline logo (square, ~32×32pt, rounded corners), left-aligned
- Flight number in bold
- Airline name in secondary text below flight number
- Status badge, right-aligned (see Status Badges below)

**Route row:**
- Origin IATA code in large bold text (left)
- Destination IATA code in large bold text (right)
- City name in smaller secondary text below each code
- Arrow or line between them; if flight is active, this becomes a progress bar with the aircraft icon at the current position

**Times row:**
- Scheduled departure time (local to origin) left-aligned
- Scheduled arrival time (local to destination) right-aligned
- "+1" or "+2" day indicator if arrival is next/following day
- If delayed: scheduled time shown in strikethrough gray, estimated time shown in amber/orange below it

**Gate/Terminal row:**
- Shows terminal and gate for each end when available
- If gate is not yet assigned: "Gate TBD"
- If gate has changed: old gate in strikethrough, new gate in amber

**Bottom meta row:**
- Aircraft type (e.g. "Boeing 777-300ER")
- Seat number if entered (e.g. "Seat 14A") with icon indicating window/middle/aisle
- Flight duration

---

### Status Badges

Color-coded pill badge, right-aligned in card header.

| Status | Label | Color |
|---|---|---|
| On time, future | "On Time" | Green |
| Delayed | "Delayed 45m" | Amber/Orange |
| Significantly delayed (>60min) | "Delayed 2h 10m" | Red |
| Cancelled | "Cancelled" | Red |
| Boarding | "Boarding" | Blue |
| Departed | "Departed" | Blue |
| In Air | "In Air" | Blue + animated pulse |
| Landed | "Landed" | Gray |
| Diverted | "Diverted" | Red |
| Scheduled, far out | "In 4 Days" or date | Gray |

"In Air" badge has a subtle animated ring pulse to signal live data.

---

### Active Flight Card (In Air State)

When a flight is currently airborne, its card expands and moves to the top of the upcoming section regardless of scheduled departure order.

Additional elements shown:

- **Progress bar** replaces the arrow between origin/destination: a horizontal track with a small airplane icon positioned at the current % complete based on elapsed time vs. total flight duration
- **Live countdown**: "Lands in 2h 14m" shown prominently below the route
- **Altitude + speed** in small secondary text: "38,000 ft · 562 mph"
- Card background uses a subtle gradient or elevated shadow to distinguish it from non-active cards

---

### Countdown Display (Pre-Departure)

For upcoming flights, the top-right of the card (or just below the status badge) shows a human-readable countdown:

- More than 7 days out: "In 12 days" (date shown on tap)
- 2–7 days: "In 3 days · Mon Mar 17"
- Same day, >3 hours: "Today · Departs in 4h 20m"
- Same day, <3 hours: Large countdown "2h 14m" replaces the standard status badge area; card expands slightly
- <1 hour: Countdown in minutes, bold, red if delayed

---

### Connection / Trip Linking

When two or more consecutive flights share the same trip, they are visually linked with a connector between cards. The connector shows:

```
┌──────────────────────────────────────┐
│  AA 447  ORD → LHR   Lands 11:45 AM │
└──────────────────┬───────────────────┘
                   │  LHR  · 2h 05m connection
                   │  ⚡ Tight
┌──────────────────┴───────────────────┐
│  BA 117  LHR → CDG   Departs 1:50 PM│
└──────────────────────────────────────┘
```

- Connector line is vertical, centered between the two cards
- Layover duration shown inline: "2h 05m connection" or "8h 30m layover"
- Connection risk label: "Relaxed", "Tight", or "Risky" with color (green / amber / red)
- Tap the connector → Connection Assistant sheet (see Gap Analysis)

---

### Empty States

**No flights at all:**
- Centered illustration (plane icon)
- "No flights yet"
- "Tap the search bar to add your first flight"

**No upcoming flights but past flights exist:**
- "No upcoming flights"
- Subtext: "Your past flights are below"
- Past flights section visible below

---

### Pull-to-Refresh

Pull down on the list → triggers a refresh of all active and upcoming flights via the edge function. Spinner in navigation bar while in progress. Each card that updates animates its status badge and time fields.

---

### Navigation Header

- Title: "My Flights" (large title, collapses on scroll)
- Right button: "+" → opens Add Flight modal (same as search screen)
- On scroll: large title collapses to inline title; search bar scrolls with content until it hits the top, then sticks

---

### Search Bar (Sticky)

The search bar described in the Search Feature section lives at the top of the home tab list, below the large title. On scroll it sticks below the navigation bar. Tapping it transitions to search mode in-place (no separate screen push) — the list fades out, suggestions animate in below the bar.

---

### Swipe Actions

Swipe left on a card → reveals:
- "Delete" (red) — removes flight from tracking
- "Share" (blue) — opens share link creation sheet

Swipe right on a card → reveals:
- "Notify" toggle (bell icon) — toggles notifications for that specific flight

---

### Live Background Map

When any flight has `status === 'active'`, a full-bleed map renders as the background of the entire home tab behind the flight list. When no flight is active, the map is not rendered — the standard app background is shown.

**Map behavior:**
- Non-interactive. The user cannot pan, zoom, or tap the map from the home tab. All map interaction is on the Flight Detail screen.
- Centered on the aircraft's current live position, with enough zoom to show both the origin and destination airports within frame.
- Auto-recenters as the aircraft moves; smooth animated position updates every 60 seconds matching the polling interval.
- If multiple flights are active simultaneously (rare but possible), the map shows the flight departing soonest or currently furthest into its journey; the others are tracked in the background.

**Map layers (bottom to top):**
1. Base map tiles — dark/muted style to keep the UI readable. Use a dark map style from MapLibre or Mapbox (e.g. "Navigation Night") rather than the default colorful tile set.
2. Faded arc — the already-flown portion of the great circle route, rendered as a dashed or lower-opacity polyline in white/light gray.
3. Remaining arc — the not-yet-flown portion, rendered as a solid brighter polyline.
4. Origin marker — small circle dot at the departure airport coordinate.
5. Destination marker — small circle dot at the arrival airport coordinate.
6. Aircraft marker — plane icon rotated to match current heading, positioned at live coordinates. Subtle drop shadow. Animates smoothly between position updates using `Animated` + coordinate interpolation.

**Frosted glass overlay:**
- A full-screen `expo-blur` component (`BlurView`, intensity ~60, tint `"dark"`) sits above the map and below the flight list scroll view.
- This ensures map content bleeds through all cards without making any text illegible.
- Each flight card does NOT have its own individual blur — the blur is one full-screen layer. Cards themselves have a semi-transparent background (`rgba(0,0,0,0.35)` or equivalent) on top of the blur.
- Status bar and navigation bar use the same blur treatment so the map shows through the full screen top to bottom.

**Great circle arc computation:**
- Computed client-side from origin and destination coordinates using the `geolib` npm package or a simple Haversine interpolation.
- Generate ~50 intermediate waypoints along the arc for smooth curve rendering.
- Split the arc at the aircraft's current position (nearest waypoint index) into flown and remaining segments.
- Recompute on each position update.

**Implementation:**
- Use `react-native-maps` with `PROVIDER_DEFAULT` (MapKit on iOS).
- Map is rendered in a `View` with `position: absolute`, `top: 0`, `left: 0`, `right: 0`, `bottom: 0`, `zIndex: 0`.
- The `ScrollView` / `FlatList` for the flight list sits above with `zIndex: 1`, `backgroundColor: 'transparent'`.
- `BlurView` from `expo-blur` fills the full screen at `zIndex: 0.5` (between map and list).
- Tab bar background also uses blur to maintain the see-through effect.

**When map activates/deactivates:**
- Animate opacity from 0 → 1 over 600ms when a flight becomes active.
- Animate opacity from 1 → 0 over 400ms when the last active flight lands.
- Do not abruptly swap backgrounds.

---

### Component Structure

```
components/
├── home/
│   ├── HomeScreen.tsx              # Root: positions map + blur + list in absolute layers
│   ├── LiveBackgroundMap.tsx       # Full-bleed MapView with arc + aircraft marker
│   ├── GreatCircleArc.tsx          # Polyline pair (flown + remaining)
│   ├── AircraftMarker.tsx          # Rotated plane icon at live position
│   ├── FlightList.tsx              # FlatList with upcoming + past sections
│   ├── FlightCard.tsx              # Full card with all states
│   ├── FlightCardActive.tsx        # Expanded in-air variant
│   ├── FlightCardPast.tsx          # Muted past flight variant
│   ├── StatusBadge.tsx             # Pill badge with color + label
│   ├── RouteProgressBar.tsx        # In-air progress bar with plane icon
│   ├── CountdownLabel.tsx          # Human-readable countdown
│   ├── TripConnector.tsx           # Vertical line + layover info between cards
│   ├── ConnectionRiskLabel.tsx     # Relaxed / Tight / Risky pill
│   └── EmptyFlightsState.tsx
```

---

### Home Tab State (Zustand)

```typescript
// homeStore.ts
{
  upcomingFlights: TrackedFlight[];
  activeFlights: TrackedFlight[];    // subset of upcoming, currently airborne
  pastFlights: TrackedFlight[];
  isRefreshing: boolean;
  lastRefreshedAt: Date | null;

  loadFlights: () => Promise<void>;
  refresh: () => Promise<void>;      // manual pull-to-refresh
  deleteFlightFromHome: (id: string) => Promise<void>;
}
```

Active flights are derived from `upcomingFlights` where `status === 'active'`. They are rendered first in the list regardless of sort order.

---

## Search Feature

### Overview

Single search bar that accepts free-form input and resolves to one of three search modes: **flight number**, **airline**, or **airport**. The mode is inferred from what the user types and surfaced as a dismissible chip attached to the input. A date selector always accompanies the search. Results are displayed inline below the bar as the user types.

---

### Search Modes

| Mode | Trigger | Example Input |
|---|---|---|
| Flight Number | Alphanumeric matching airline IATA + digits | "AA447", "ua 123", "EK 202" |
| Airline | Airline name or IATA code with no digits | "United", "AA", "Emirates" |
| Airport | City name, airport name, or IATA code | "JFK", "Chicago", "Heathrow" |

Mode is inferred client-side before any API call. If input is ambiguous (e.g. "AA" could be airline or flight number prefix), show both airline chip and await more input before firing search.

---

### Chip Design

Once the mode is resolved, a chip appears inline in the search bar — left of the cursor, right of any previous chips.

**Flight Number chip:**
```
[🟦 AA logo] AA 447  ×
```
- Airline logo (square, rounded corners, ~20×20pt)
- IATA code + flight number
- Tap × to clear and restart

**Airline chip:**
```
[🟦 AA logo] American Airlines  ×
```
- Full airline name
- Logo identical to flight number chip

**Airport chip:**
```
[🇺🇸 flag] JFK — John F. Kennedy  ×
```
- Country flag as circular image (~20×20pt)
- IATA code + full airport name
- Flag is derived from the airport's country ISO code → flag emoji or local image asset

**Multiple chips (route search):**
User can chain two airport chips to define an origin → destination pair:
```
[🇺🇸] ORD  ×  →  [🇬🇧] LHR  ×
```
Once both chips are present, search fires for all flights on that route for the selected date.

---

### Search Input Behavior

1. User taps search bar → keyboard appears, date defaults to today
2. As user types:
   - 2+ chars: begin local fuzzy match against cached airline/airport lists
   - Show dropdown of suggestions (max 5) with logos/flags
3. User taps a suggestion → chip is inserted, text field clears
4. If chip type is airport:
   - Search field remains active for a second airport chip (destination)
   - If second airport entered → route mode
   - If user taps search/return with one airport → airport departures/arrivals mode
5. Date picker is always accessible via a pill button adjacent to the search bar

---

### Suggestions Dropdown

Each row in the dropdown:

**Airline row:**
```
[logo 28×28]  American Airlines          AA
              Star Alliance              (sub-label, optional)
```

**Airport row:**
```
[flag 28×28]  John F. Kennedy Intl       JFK
              New York, United States    (city + country)
```

**Flight number row** (shown when input matches IATA + digits):
```
[logo 28×28]  AA 447                     Today 8:15 AM → 4:30 PM
              ORD → LHR                  On Time
```

---

### Search Result Views

#### Flight Number Results
Single flight card (or multiple if same number operates multiple legs that day):
- Airline logo + flight number
- Origin → Destination (city names, not IATA)
- Departure time (local) / Arrival time (local)
- Status badge
- Aircraft type
- "Add to Flights" button → saves to `tracked_flights`, associates with active trip if one is open

#### Airline Results
Scrollable list of that airline's flights for the selected date, grouped by departure time. Same card format as above. Filter chips at top: "All", "Departing", "Arriving", "In Air".

#### Airport Results (single airport)
Two tabs: **Departures** | **Arrivals**
- Each tab: time-sorted list of flights
- Each row: airline logo, flight number, destination/origin, scheduled time, status badge, gate
- Tap row → Flight Detail (not auto-added; separate "Add" button on detail screen)

#### Route Results (origin + destination pair)
- All nonstop flights between the two airports on the selected date
- Sorted by departure time
- Shows duration, aircraft type, status

---

### Local Data Caches (ship with app)

Both lists are static JSON bundled with the app. Updated on app release. Used exclusively for instant suggestion matching — no network call needed.

**`airlines.json`** — ~800 active commercial airlines:
```json
{
  "AA": {
    "name": "American Airlines",
    "iata": "AA",
    "icao": "AAL",
    "logo_url": "https://content.airhex.com/content/logos/airlines_AA_100_100_s.png",
    "alliance": "oneworld",
    "country": "US"
  }
}
```

**`airports.json`** — ~3,500 airports with scheduled service:
```json
{
  "ORD": {
    "name": "O'Hare International",
    "city": "Chicago",
    "country": "US",
    "country_iso": "US",
    "iata": "ORD",
    "lat": 41.9742,
    "lon": -87.9073,
    "timezone": "America/Chicago"
  }
}
```

**Airline logos:** Use [Airhex](https://airhex.com) API or pre-download a logo set. URL pattern: `https://content.airhex.com/content/logos/airlines_{IATA}_100_100_s.png`. Cache in `expo-file-system` after first load.

**Country flags:** Use `country-flag-icons` npm package for SVG flags keyed by ISO 3166-1 alpha-2 code. Render as circular clipped image.

---

### Date Picker

- Pill button labeled "Today", "Tomorrow", or formatted date (e.g. "Mar 15")
- Tap → bottom sheet with horizontal date strip (±7 days from today, scrollable)
- Dates in the past: still selectable (for historical lookup)
- Default: today

---

### Manual Entry Fallback

If search returns no results, show:
> "Can't find this flight? Add it manually."

Manual entry form (bottom sheet):
- Departure airport (airport chip picker)
- Arrival airport (airport chip picker)
- Departure date
- Flight number (optional)
- Airline (optional)
- Departure time (optional)

Minimum required: departure airport + arrival airport + date. Saved as a `tracked_flight` with `source = 'manual'`, excluded from live status polling.

---

### Component Structure

```
components/
├── search/
│   ├── SearchBar.tsx          # Input + chips + dropdown trigger
│   ├── SearchChip.tsx         # Individual chip (airline/airport/flight)
│   ├── SuggestionDropdown.tsx # Fuzzy-matched suggestion list
│   ├── SuggestionRow.tsx      # Single row (logo/flag + name + code)
│   ├── DatePill.tsx           # Date selector pill
│   ├── DateStripPicker.tsx    # Bottom sheet date strip
│   ├── FlightResultCard.tsx   # Single flight result
│   ├── AirportBoard.tsx       # Dep/arr board for airport mode
│   └── RouteResultsList.tsx   # Route mode results
```

---

### Search State (Zustand)

```typescript
// searchStore.ts
{
  query: string;
  mode: 'idle' | 'flight_number' | 'airline' | 'airport' | 'route';
  chips: SearchChip[];           // max 2 (origin + destination for route mode)
  date: Date;
  suggestions: Suggestion[];
  results: SearchResult | null;
  isLoading: boolean;

  setQuery: (q: string) => void;
  addChip: (chip: SearchChip) => void;
  removeChip: (index: number) => void;
  setDate: (d: Date) => void;
  search: () => Promise<void>;
  clear: () => void;
}
```

---

## Flighty Features — Gap Analysis

Features Flighty has that are not yet in this architecture. Prioritized by implementation effort vs. value for a single user.

### High Value, Low Effort

**Calendar Import**
- Flighty parses flight confirmation emails and calendar events to auto-import flights
- Implementation: `expo-calendar` to read iOS calendar events; regex patterns for airline booking format (PNR, flight number, date); prompt user to confirm before saving
- Also: parse forwarded email text (user pastes or shares to app) using the same regex patterns

**Morning-Of Assistant**
- At a configurable time on flight day (default 6 AM), send a summary notification: flight status, inbound aircraft location, gate, weather at origin
- Implementation: additional cron trigger in `poll-flights` edge function scoped to same-day flights

**Check-In Assistant**
- At T-24h, send notification with deep link to airline's check-in page
- Implementation: static map of `airline_iata → check_in_url_template` (e.g. `https://www.aa.com/reservation/retrieveReservationLogin.do`)

**Live Activity / Dynamic Island**
- Show real-time flight progress on Lock Screen and Dynamic Island during flight
- Implementation: `expo-live-activities` (third-party, or native module); update pushed from edge function as flight status changes

### High Value, Medium Effort

**Inbound Aircraft Tracker ("Where's My Plane")**
- Track the tail number of the aircraft assigned to your flight for the 25 hours prior to departure
- Shows the aircraft's current/previous legs so you can predict if your flight will be delayed due to a late inbound
- Implementation: AeroAPI supports tail number lookup and aircraft schedule; requires upgrading from AviationStack

**Connection Assistant**
- For multi-leg trips, flag tight connections as "Risky" or "Tight"
- Uses airport layout data + actual arrival time of inbound leg vs. departure time of outbound leg
- Implementation: store connection pairs in `trips` schema; compute connection window on each sync; notify if window shrinks below threshold (user-configurable, default 45 min)

**Delay Cause**
- Flighty shows the specific reason for a delay (late aircraft, ATC, weather, crew)
- Implementation: AeroAPI's `/flights/{ident}/delays` endpoint returns delay codes; map IATA delay codes to human-readable strings

### Medium Value, Medium Effort

**Airport Weather**
- Show weather at origin and destination on the flight detail screen
- Implementation: OpenWeatherMap API keyed on airport lat/lon; call once on flight detail open, cache for 30 min

**Seat Maps**
- Show the aircraft seat map with the user's seat highlighted
- Implementation: SeatGuru has an unofficial API; alternatively use `seats.aero` which has a documented API for seat maps. User enters seat number manually (already in schema)

**Flight History / Stats (Passport)**
- Total miles flown, hours in air, airlines used, airports visited, time lost to delays
- Implementation: compute from `tracked_flights` where `status = 'landed'` and `actual_departure` is set; distance from origin/destination coordinates (Haversine formula); store in a `flight_stats` materialized view in Supabase

**Tail Alerts**
- Notify user if they've flown on this specific tail number before
- Implementation: store tail numbers in flight history; cross-reference on new flight add

### Low Priority

**TripIt / Email Import** — requires OAuth or email parsing service; high complexity for single user
**Apple Watch app** — requires separate WatchKit target
**iPad / Mac app** — Catalyst works for free with RN Web + Expo; low effort but low single-user value
**Baggage Claim** — AeroAPI provides this on landing; easy add to the landed state of Flight Detail

---



- Android (iOS-first; RN makes Android trivial to add later)
- Baggage tracking
- Carbon offset calculations
- Recipient push notifications (they view via web only)
