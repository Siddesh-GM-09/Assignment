# Codeyoung Trial Class Booking System

## Project overview

A customer-facing booking experience for a free, one-to-one trial class. Parents choose a local time and timezone; the API checks capacity, assigns one of ten mentors, saves the UTC appointment, records dummy notifications, and issues an opaque demo-class link.

## Problem statement

Schedule trial classes across parent and mentor timezones without mentor overlaps or exceeding two sessions per mentor's local calendar day. Availability can change between browsing and confirming, so the booking API is authoritative.

## Features

- Responsive booking journey with automatic browser-timezone suggestion and explicit timezone choice.
- Server-generated appointment slots, validation, deterministic mentor assignment, and useful conflict responses.
- Secure random class token and working demo-class details page.
- Parent and mentor notification records (no email is sent).
- Demo Admin View with mentor, capacity, and booking information.
- Ten fictional seeded mentors, with six in India and four in US/Europe zones.
- Vitest coverage for timezone/DST behavior and database booking flows.

## Architecture

The backend follows Routes → Controllers → Services → Prisma. `BookingService` owns slot availability, UTC conversion, capacity selection, booking transaction, notifications, and booking view shaping. Controllers validate Zod input and map to JSON. Central error middleware returns stable public error codes and hides unexpected internals. The React app uses React Router for pages and TanStack Query for server state.

## Technology choices

Node.js, TypeScript, Express, Prisma, SQLite, Zod, Luxon, Vitest, React, Vite, React Router, TanStack Query, Helmet, and express-rate-limit. SQLite keeps local setup simple; the database boundary is Prisma so PostgreSQL can be adopted later.

## Folder structure

```text
backend/
  prisma/{schema.prisma,seed.ts}
  src/{config,controllers,errors,middleware,services,utils,validators}/
  tests/{unit,integration}/
frontend/
  src/{pages,components,services,styles,types,utils}/
```

## Database schema explanation

`Mentor` stores active status and an IANA timezone. `Parent` stores contact details and preferred timezone. `Booking` stores UTC start/end instants and both timezone identifiers, status, generated token, and class URL. `Notification` records recipient, type, message, and delivery state. Relations and indexes support mentor schedule lookup; notifications cascade when a booking is removed. Times are real `DateTime` instants, never local wall-clock strings.

## Booking flow

The browser fetches slots for the selected date and IANA timezone. On confirmation it sends parent details and a local date/time. The API validates the request, converts that wall time with Luxon, checks eligible active mentors, orders by same-local-day load then mentor ID, and atomically writes the booking and two notification records. The response includes parent- and mentor-local rendered time. If a slot fills after display, the API responds with a friendly `409 NO_MENTOR_AVAILABLE`; the client refreshes slots on the next query interaction and invites another choice.

## Mentor assignment algorithm

Candidates are active mentors without a confirmed appointment overlapping `[start,end)`. For each candidate, the service derives the UTC boundaries of the appointment's day in that mentor's IANA zone, counts confirmed bookings in those boundaries, and drops mentors already at two. Remaining mentors are sorted by ascending daily count and stable mentor ID. Back-to-back sessions are allowed because overlap uses strict `<`/`>` boundaries. A lack of candidates yields `NO_MENTOR_AVAILABLE`.

## Timezone strategy

The UI submits local date/time plus IANA zone, never an offset. Luxon constructs the zoned local datetime and converts it to UTC for storage. Responses format the same instant independently in parent and mentor zones. `Intl.supportedValuesOf('timeZone')` backs the timezone API. The current UI offers common US, UK, EU, and India zones; API accepts any valid IANA zone.

## DST handling

Luxon/IANA rules provide seasonal offsets; there is no manual offset arithmetic. Invalid or normalized nonexistent wall times are rejected. The fall-back repeated hour follows Luxon's earlier-offset disambiguation. This assignment's hourly slot grid starts on the hour, so it does not expose ambiguous half-hour fall-back entries. Tests cover winter/summer New York conversion and spring/fall transition cases.

## Mentor daily limit

Capacity counts use `[local start of day, next local start of day)` converted to UTC for each mentor. That handles timezone and DST boundaries correctly, including when the mentor's calendar date differs from UTC. Limit is two confirmed classes for that mentor-local date.

## Concurrency considerations

Candidate inspection and booking insertion run in a Prisma interactive transaction; SQLite serializes writes and may surface lock contention under concurrent writers. This avoids treating a stale client slot list as authoritative, but SQLite does not provide PostgreSQL-style row locks, and this small demo does not claim high-scale locking guarantees. There is no database exclusion constraint on time ranges. An optional unique idempotency key is stored with the booking and a retry replays the original result. For production/high concurrency, move to PostgreSQL and use serializable transactions or a per-mentor advisory/row lock plus a database exclusion constraint on confirmed time ranges; retry serialization conflicts.

## Error handling

Validation errors use 422, missing records use 404, and capacity conflicts use 409. Unexpected errors are logged server-side and return a generic 500. Responses contain `{success,data}` or `{success:false,error:{code,message}}` and do not expose stack traces.

## Validation

Zod validates parent name/email, timezone presence, date format, and time format. Luxon validates supported zones and real local times; past appointments are rejected. Frontend browser validation improves usability but backend validation is authoritative.

## Testing

Run the local database setup once, then run `npm test`. Unit tests cover timezone conversion, DST, rendering, local mentor-day boundaries, and nonexistent local times. Integration tests copy `backend/prisma/dev.db` into an isolated `backend/prisma/test.db`; test cleanup affects only that copy. They cover successful assignment, idempotent retry, notification records, booking/class retrieval, unknown IDs/tokens, and mentor-local daily capacity.

## API documentation

All endpoints are prefixed by `/api`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service health |
| GET | `/timezones` | IANA timezone list |
| GET | `/slots?date=YYYY-MM-DD&timezone=Area/City` | Available local starts |
| POST | `/bookings` | Create booking; JSON `{name,email,timezone,date,time,idempotencyKey?}` |
| GET | `/bookings/:id` | Booking details |
| GET | `/bookings/:id/class` | Booking class details |
| GET | `/class/:token` | Resolve opaque demo class token |
| GET | `/admin` | Mentor utilization and bookings |

## Local setup

Requirements: Node.js 20+ and npm. From repository root:

```powershell
Copy-Item backend/.env.example backend/.env
npm install
npm --workspace backend exec prisma generate
npm --workspace backend exec prisma db push
npm --workspace backend exec tsx prisma/seed.ts
npm run dev
```

Open `http://localhost:5173`. API defaults to `http://localhost:3001`.

## Environment variables

See [`.env.example`](.env.example). Backend reads `backend/.env`; `DATABASE_URL` is Prisma's SQLite URL. `PORT`, `FRONTEND_URL`, `SLOT_DURATION_MINUTES`, `BOOKING_WINDOW_DAYS`, `BUSINESS_START_HOUR`, and `BUSINESS_END_HOUR` configure local operation. `PUBLIC_APP_URL` optionally overrides generated class-link origin. Never commit `.env`.

## Database setup

Prisma schema is `backend/prisma/schema.prisma`. `prisma db push` creates the local SQLite schema without requiring Docker. To rebuild a disposable local database, remove `backend/prisma/dev.db` and repeat setup.

## Seed data

The seed command upserts exactly ten fictional mentors (`mentor1@example.com` through `mentor10@example.com`); it is safe to rerun. Six use Asia/Kolkata and others use New York, London, Los Angeles, and Berlin. No sensitive data is included.

## How to run backend

`npm run dev:backend` starts the API in watch mode. `npm --workspace backend run build` builds TypeScript; `npm --workspace backend start` runs compiled output.

## How to run frontend

`npm run dev:frontend` starts Vite. `VITE_API_URL` can override the API base URL (default `http://localhost:3001/api`). `npm --workspace frontend run build` creates the static production bundle.

## How to run tests

After local database setup, `npm test` runs the backend Vitest suite. `npm run build` builds both apps. `npm run lint` runs each workspace's lint command.

## Example booking flow

Start services, open the app, provide a name/email, select an offered timezone and a date within the booking window, select an available time, and confirm. Inspect both local appointment times and open the class link. Visit **Demo admin** to see the new booking and mentor utilization.

## Edge cases considered

No mentor, inactive mentor, overlaps, strict half-open appointment boundaries (back-to-back allowed), two per mentor-local day, past dates/times, invalid zones, spring DST gaps, fall repeated hour, parent/mentor date difference, opaque invalid links, invalid booking IDs, retry-friendly conflict behavior, duplicate click loading state, and API failure states. Multiple legitimate bookings per parent are allowed.

## Scope and Deliberate Non-Goals

No real email, authentication, payment, video conferencing, calendar integrations, parent/mentor accounts, or deployment stack. Notification rows stand in for a provider adapter; class links lead to a demo page rather than a video call. Admin view is intentionally unauthenticated for evaluator demonstration.

## Production improvements

Add authentication/authorization, PostgreSQL migrations and range exclusion constraints, email and video provider adapters, cancellation/rescheduling flows, audit retention policies, richer observability/metrics, accessibility audit, and deployment secrets/HTTPS controls. The demo rate limit and CORS defaults are starting points, not a production security claim.

## Trade-offs

Hourly local starts keep the product simple. The app currently provides an explicit common-zone selector instead of an exhaustive searchable picker. SQLite is convenient for review and single-instance demo use but is not a high-throughput scheduler database. Notifications are recorded in the booking transaction rather than sent asynchronously.

## Assumptions

Business hours are local to the parent-selected timezone. Slots begin on the hour and last the configured duration. All mentors can consider every offered parent slot; mentor-zone business-hours restrictions were not specified. A mentor's daily cap uses the mentor's local date. Cancelled bookings no longer consume capacity.

## Demo credentials

No credentials are required. Admin is openly accessible for this assignment only.
