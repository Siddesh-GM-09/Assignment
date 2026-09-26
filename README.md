# CodeYoung Trial Class Booking

A full-stack trial-class scheduler for parents and mentors in different timezones. Parents choose a course and local time, the API assigns an eligible mentor, and both receive a booking-specific classroom reference by email.

## What the app includes

- Responsive parent booking form with detected timezone, course selection, live availability, and a backend-ranked recommended time.
- UTC-backed booking times with parent and mentor timezone comparison, including local date changes and daylight-saving transitions.
- Ten fictional demo mentors with seeded course assignments and a limit of two confirmed classes per mentor's local calendar day.
- Transactional booking and rescheduling, idempotency keys, private booking-management tokens, cancellation, and notification records.
- A unique private CodeYoung classroom waiting-room URL for each booking, plus an `.ics` calendar download.
- Responsive waiting room with status, mentor, course, local times, and a UTC-based countdown.
- SMTP confirmation, reschedule, and cancellation emails for parents and mentors. A parent-only management link is included in parent emails.
- Authenticated `/admin` operations dashboard with capacity, schedule, database-backed analytics, email delivery status, mentor controls, and booking cancellation.
- Database readiness health endpoint and tests for assignment, conflicts, rescheduling, cancellation, timezone rules, recommendations, calendar export, and admin authorization.

## Technology and architecture

Node.js, TypeScript, Express, Prisma, SQLite, Luxon, Zod, Vitest, React, Vite, React Router, and TanStack Query. Backend flow is Routes → Controllers → `BookingService` → Prisma. The service owns availability, UTC conversion, mentor assignment, transaction boundaries, private booking capabilities, and notifications. SMTP delivery happens only after the booking transaction commits; a mail failure does not roll back a class.

## Booking and timezone behavior

The browser submits a local date, local time, IANA timezone, course, and idempotency key. The API validates the actual wall time and configured business window, converts it to UTC, and checks overlap and mentor-local daily capacity inside a transaction. A mentor is assigned only if active, assigned to the requested demo course, free for the full slot, and below two classes on that mentor's local date. Concurrent requests are checked again by the API rather than trusting the displayed availability.

The recommendation endpoint ranks real available slots using current mentor load, number of available mentors, and an after-school time preference. It returns human-readable reasons and available alternatives; it does not expose a scoring value. Parent and mentor local times are formatted from the same UTC instant by Luxon.

## Private classroom and meeting provider

Each booking stores its own random classroom token, unique classroom URL (`classLink`), and `meetingProvider` value. The current `InternalClassroomProvider` creates a private waiting-room route at `/class/:token`. The classroom API uses the 256-bit random token as a bearer capability and returns only classroom details; it does not return parent email or booking-management credentials. Booking detail, rescheduling, and parent cancellation require a separate random management token. Admin routes require an authenticated admin session.

Each booking has its own classroom/meeting reference. The current development implementation uses the `INTERNAL_CLASSROOM` provider abstraction; real Google Meet generation requires Google API credentials and integration. The current room is a waiting room and **does not provide live audio or video**. The old shared `GOOGLE_MEET_LINK` setting is no longer used by the booking or email flow. The provider interface is the integration point for a future real meeting provider.

## Email behavior

Set SMTP values to send branded, mobile-friendly confirmation, reschedule, and cancellation messages. User-provided names and other inserted text are HTML-escaped. Emails include the course, booking reference, each recipient's local time, the unique private classroom link, and a parent-only management link. Email failures are recorded as `FAILED` notification states after the database change commits. Tests suppress external email delivery.

## Admin and analytics

`/admin` uses a single configured admin account, an eight-hour signed `HttpOnly` cookie, exact-origin credentialed CORS, and a login rate limit. All dashboard and control endpoints check that session. The dashboard shows mentor-local capacity, upcoming classes, recent booking activity, totals by booking status, course interest, popular parent-local start hours, weekly/monthly counts, and cancellation rate from database records. Empty analytics show “No booking data yet.” Completed totals are derived from confirmed classes whose end time has passed; the stored booking status remains `CONFIRMED`.

Admin can enable or disable mentors and cancel confirmed bookings. A parent can change or cancel a booking through the management token delivered in the confirmation email. Rescheduling checks the new slot and mentor capacity within a transaction, records a reschedule history row, preserves the per-booking classroom, and sends updated notifications after commit.

## Health endpoint

`GET /api/health` performs a database query and returns status, timestamp, database status, and app version. It returns HTTP 503 with a degraded state if the database is unavailable. It does not expose environment values, credentials, or tokens.

## Local setup

Requirements: Node.js 20+ and npm. In PowerShell from the repository root:

```powershell
Copy-Item backend/.env.example backend/.env
npm install
npm --workspace backend exec -- prisma generate --schema prisma/schema.prisma
npm --workspace backend exec -- prisma db push --schema prisma/schema.prisma
npm --workspace backend exec -- tsx prisma/seed.ts
npm run dev
```

`prisma db push` applies the additive schema updates to the existing SQLite database and preserves existing records. Run it after pulling schema changes. The seed script is safe to rerun: it updates the ten named demo mentors without resetting their active/inactive state, and upserts demo course assignments.

Open `http://localhost:5173`. The API listens at `http://localhost:3001` by default. The frontend can override its API origin with `VITE_API_URL`.

## Environment variables

Backend reads `backend/.env`; the matching starter is [backend/.env.example](backend/.env.example).

- `DATABASE_URL`: Prisma SQLite URL, default `file:./dev.db`.
- `PORT`, `FRONTEND_URL`: API port and allowed frontend origin.
- `SLOT_DURATION_MINUTES`, `BOOKING_WINDOW_DAYS`, `BUSINESS_START_HOUR`, `BUSINESS_END_HOUR`: slot and booking window settings.
- `PUBLIC_APP_URL`: public frontend origin used when generating each private classroom URL.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`: single admin login. Set an email, a password of at least 12 characters, and a random session secret of at least 32 characters. For a random secret, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste its output into `ADMIN_SESSION_SECRET`. Restart the backend after changing these settings. Example files do not include default admin credentials.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USER` and `SMTP_PASSWORD`, and `MAIL_FROM`: outbound notification email.

Never commit `backend/.env`. No Google Meet URL or credential is required by the current internal classroom provider.

## API reference

All routes use the `/api` prefix.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Database-aware readiness status |
| GET | `/timezones` | IANA timezone list |
| GET | `/slots?date=YYYY-MM-DD&timezone=Area/City&subject=Coding` | Available parent-local slots and eligible mentor counts |
| GET | `/recommendations?date=YYYY-MM-DD&timezone=Area/City&subject=Coding` | Ranked recommendation and alternatives |
| POST | `/bookings` | Create booking; body includes name, email, timezone, date, time, subject, idempotency key |
| GET | `/bookings/:id?token=...` | Private booking details; management token required |
| POST | `/bookings/:id/reschedule` | Change date/time; management token required |
| POST | `/bookings/:id/cancel` | Parent cancellation; management token required |
| GET | `/class/:token` | Private classroom waiting-room details |
| GET | `/class/:token/calendar.ics` | Download the booking's calendar event |
| GET | `/admin/session` | Report admin configuration and session state |
| POST | `/admin/login` | Create admin session |
| POST | `/admin/logout` | Clear admin session |
| GET | `/admin` | Operations dashboard data; admin session required |
| PATCH | `/admin/mentors/:id` | Enable or disable a mentor; admin session required |
| POST | `/admin/bookings/:id/cancel` | Admin cancellation; admin session required |

Responses use `{success,data}` or `{success:false,error:{code,message}}`. Conflict responses may include available alternative slots.

## Tests and builds

Run after local database setup:

```powershell
npm test
npm run lint
npm run build
```

Integration tests copy `backend/prisma/dev.db` to an isolated `backend/prisma/test.db`. Test cleanup affects only that copy. Tests use test-only admin credentials from Vitest configuration and never send emails.

## Seed data and limitations

Mentor names, course assignments, and `example.com` addresses are fictional demo records. The seed script does not create appointments or send email; without real booking activity, analytics correctly show no data. This app has a single admin account and does not include parent accounts, student profiles, payment, live video, Google Calendar API, or automatic email retries. A class token is a private bearer link; anyone with that link can view the room's limited class details. SQLite is intended for local/single-instance review rather than high-concurrency production deployment.
