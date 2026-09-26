import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ApiError, request } from './services/api';
import type { Booking, Classroom, Recommendation, Slot, Subject } from './types';
import { countdownParts } from './utils/countdown';

const zones = [
  ['America/New_York', 'Eastern Time · US & Canada'],
  ['America/Los_Angeles', 'Pacific Time · US & Canada'],
  ['Europe/London', 'British Time'],
  ['Europe/Berlin', 'Central European Time'],
  ['Asia/Kolkata', 'India Standard Time'],
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">
          <span className="mark">c</span> codeyoung
        </Link>
        <nav>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      {children}
      <footer>
        Made for curious minds <span>·</span> A complimentary 1:1 trial class
      </footer>
    </>
  );
}

function Countdown({ startUtc }: { startUtc: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const sync = () => setNow(Date.now());
    const timer = window.setInterval(sync, 1000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  const { remainingMilliseconds: remaining, days, hours, minutes, seconds } = countdownParts(startUtc, now);
  const units: Array<[number, string]> = [[days, 'days'], [hours, 'hours'], [minutes, 'minutes'], [seconds, 'seconds']];
  return (
    <section className="countdown" aria-label="Countdown to the class start">
      <div className="eyebrow">{remaining > 0 ? 'CLASS STARTS IN' : 'CLASS START TIME'}</div>
      {remaining > 0 ? <div className="countdown-grid" role="timer" aria-live="off">
        {units.map(([value, label]) => <div className="countdown-unit" key={label}><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>)}
      </div> : <p className="countdown-now">Your scheduled start time has arrived.</p>}
    </section>
  );
}

function TimezoneComparison({ startUtc, parentTimezone, mentorTimezone }: { startUtc: string; parentTimezone: string; mentorTimezone: string }) {
  const parentTime = DateTime.fromISO(startUtc, { zone: parentTimezone });
  const mentorTime = DateTime.fromISO(startUtc, { zone: mentorTimezone });
  const differentDate = parentTime.toISODate() !== mentorTime.toISODate();
  return (
    <section className="timezone-comparison" aria-label="The same class time in both timezones">
      <div><small>PARENT · {parentTimezone}</small><strong>{parentTime.toFormat('ccc, LLL d · h:mm a ZZZZ')}</strong></div>
      <span className="timezone-connector" aria-hidden="true">↕<small>SAME MOMENT</small></span>
      <div><small>MENTOR · {mentorTimezone}</small><strong>{mentorTime.toFormat('ccc, LLL d · h:mm a ZZZZ')}</strong></div>
      {differentDate && <p className="hint">The class falls on different calendar dates in these timezones.</p>}
    </section>
  );
}

function MentorProfile({ name, timezone, subject }: { name: string; timezone: string; subject: string }) {
  return <section className="mentor-profile" aria-label="Assigned mentor">
    <span className="mentor-profile-icon" aria-hidden="true">✦</span>
    <div><small>YOUR MENTOR · {subject}</small><strong>{name}</strong><span>Local timezone: {timezone}</span></div>
  </section>;
}

function BookingPage() {
  const navigate = useNavigate();
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultTimezone = (() => {
    try { new Intl.DateTimeFormat('en', { timeZone: detectedTimezone }); return detectedTimezone; }
    catch { return 'America/New_York'; }
  })();
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [date, setDate] = useState(() => DateTime.now().setZone(defaultTimezone).toISODate()!);
  const [subject, setSubject] = useState<Subject>('Coding');
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [error, setError] = useState('');
  const [alternatives, setAlternatives] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const query = new URLSearchParams({ date, timezone, subject });
  const slotQuery = useQuery({
    queryKey: ['slots', date, timezone, subject],
    queryFn: () => request<Slot[]>(`/slots?${query.toString()}`),
  });
  const recommendationQuery = useQuery({
    queryKey: ['recommendations', date, timezone, subject],
    queryFn: () => request<{ recommended: Recommendation | null; alternatives: Recommendation[]; message?: string }>(`/recommendations?${query.toString()}`),
  });
  const localToday = DateTime.now().setZone(timezone);
  const minDate = localToday.toISODate()!;
  const maxDate = localToday.plus({ days: 14 }).toISODate()!;
  const timezoneOptions = zones.some(([id]) => id === detectedTimezone) ? zones : [[detectedTimezone, 'Your detected timezone'], ...zones];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setAlternatives([]);
    setLoading(true);
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const result = await request<Booking>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ ...form, timezone, date, time: slot, subject, idempotencyKey: idempotencyKey.current }),
      });
      if (!result.managementToken) throw new Error('Your booking was created, but its private management link was not returned. Check your email for the secure link.');
      idempotencyKey.current = null;
      navigate(`/booking/${result.id}?token=${encodeURIComponent(result.managementToken)}`);
    } catch (err) {
      const apiError = err as ApiError;
      setError(err instanceof Error ? err.message : 'Please try again.');
      setAlternatives(apiError.alternatives ?? []);
      if (apiError.code === 'NO_MENTOR_AVAILABLE' || apiError.code === 'BOOKING_CONFLICT') {
        setSlot('');
        void slotQuery.refetch();
      }
    } finally {
      setLoading(false);
    }
  }

  const recommended = recommendationQuery.data?.recommended;
  return (
    <Shell>
      <main className="wrap">
        <section className="hero">
          <div>
            <div className="eyebrow"><i /> COMPLIMENTARY TRIAL CLASS</div>
            <h1>Big ideas start<br />with <em>one great class.</em></h1>
            <p>Choose what you’d like to explore and find a class time that works for your family. We’ll match you with an available mentor.</p>
            <div className="hero-note"><span>✦</span> Personalised learning, one-on-one</div>
          </div>
          <div className="art" aria-hidden="true"><div className="orb orb1" /><div className="orb orb2" /><div className="book">✳</div><div className="bubble">A little<br />curiosity goes<br /><b>a long way!</b></div><div className="pill">Learn at your pace</div></div>
        </section>

        <form className="card booking-card" onSubmit={(event) => void submit(event)}>
          <div className="cardhead"><div><div className="eyebrow">LET’S FIND YOUR TIME</div><h2>Book a free trial</h2></div><div className="step">01 <span>/ 01</span></div></div>
          <div className="fields">
            <label>Your name<input required minLength={2} maxLength={80} autoComplete="name" placeholder="e.g. Jordan Lee" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Email address<input required type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          </div>
          <div className="fields second">
            <label>Explore a course<select value={subject} onChange={(event) => { setSubject(event.target.value as Subject); setSlot(''); }}>
              <option>Coding</option><option>Creative AI</option><option>Robotics</option><option>Math Puzzles</option>
            </select></label>
            <label>Your timezone<select value={timezone} onChange={(event) => { const next = event.target.value; setTimezone(next); setDate(DateTime.now().setZone(next).toISODate()!); setSlot(''); }}>
              {timezoneOptions.map(([id, label]) => <option value={id} key={id}>{label} ({id})</option>)}
            </select></label>
          </div>
          <label className="date-choice">Choose a date<input type="date" min={minDate} max={maxDate} value={date} onChange={(event) => { setDate(event.target.value); setSlot(''); }} /></label>

          {recommendationQuery.isLoading ? <div className="recommendation-skeleton" aria-label="Finding the best time">Finding a good time for your timezone…</div> : recommended && (
            <section className="recommendation-card" aria-label="Recommended class time">
              <div className="recommendation-top"><span aria-hidden="true">✦</span><div><small>RECOMMENDED FOR YOUR SCHEDULE</small><strong>{DateTime.fromISO(recommended.startUtc).setZone(timezone).toFormat('cccc, LLL d · h:mm a')}</strong></div></div>
              <p>{recommended.reason} {recommended.availableMentors} {recommended.availableMentors === 1 ? 'mentor is' : 'mentors are'} currently available.</p>
              {recommended.mentorTimezone && <TimezoneComparison startUtc={recommended.startUtc} parentTimezone={timezone} mentorTimezone={recommended.mentorTimezone} />}
              <button type="button" className="recommendation-pick" onClick={() => { setSlot(recommended.time); setError(''); }}>{slot === recommended.time ? 'Recommended time selected ✓' : 'Choose this time →'}</button>
            </section>
          )}

          <div className="slotheading"><div><b>Pick a time</b><span> · shown in your selected timezone</span></div><span className="tzchip">◷ {timezone}</span></div>
          <div className="slots" aria-live="polite">
            {slotQuery.isLoading ? <p className="muted">Finding available mentors…</p> : slotQuery.isError ? <p className="error">{(slotQuery.error as Error).message} <button type="button" className="linkbutton" onClick={() => void slotQuery.refetch()}>Retry</button></p> : slotQuery.data?.length ? slotQuery.data.map((item) => (
              <button type="button" key={item.time} className={`slot ${slot === item.time ? 'selected' : ''}`} aria-pressed={slot === item.time} onClick={() => { setSlot(item.time); setError(''); }}>
                {item.label}<small>{item.availableMentors} free</small>
              </button>
            )) : <p className="muted">{recommendationQuery.data?.message ?? `No times are available for ${subject} on this date. Try another day.`}</p>}
          </div>
          {error && <div className="alert" role="alert"><strong>This time needs another choice.</strong><span>{error}</span>
            {alternatives.length > 0 && <div className="alternative-slots">{alternatives.map((item) => <button type="button" className="slot" key={item.time} onClick={() => { setSlot(item.time); setError(''); }}>{item.label}<small>{item.availableMentors} free</small></button>)}</div>}
            {!alternatives.length && <button type="button" className="linkbutton" onClick={() => void slotQuery.refetch()}>See refreshed availability</button>}
          </div>}
          <button className="button full" disabled={!slot || loading || slotQuery.isFetching} aria-busy={loading}>
            {loading ? 'Finding your mentor…' : 'Confirm trial class'} <span>→</span>
          </button>
          <div className="privacy">No payment needed <span>·</span> Mentor times are shown in their timezone too</div>
        </form>
      </main>
    </Shell>
  );
}

function ChangeBookingForm({ booking, managementToken, onChanged }: { booking: Booking; managementToken: string; onChanged: (booking: Booking) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(DateTime.now().setZone(booking.parent.timezone).toISODate()!);
  const [timezone, setTimezone] = useState(booking.parent.timezone);
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  const [changeAlternatives, setChangeAlternatives] = useState<Slot[]>([]);
  const slotsQuery = useQuery({
    queryKey: ['reschedule-slots', date, timezone, booking.subject, open],
    queryFn: () => request<Slot[]>(`/slots?${new URLSearchParams({ date, timezone, subject: booking.subject })}`),
    enabled: open,
  });
  const changeMutation = useMutation({
    mutationFn: () => request<Booking>(`/bookings/${encodeURIComponent(booking.id)}/reschedule`, {
      method: 'POST', body: JSON.stringify({ managementToken, date, time, timezone, subject: booking.subject }),
    }),
    onSuccess: (updated) => { setMessage('Your booking time has been updated, and the parent and mentor have been notified.'); setChangeAlternatives([]); setOpen(false); onChanged(updated); },
    onError: (error) => { setMessage((error as Error).message); setChangeAlternatives((error as ApiError).alternatives ?? []); },
  });
  if (booking.status !== 'CONFIRMED') return null;
  return <div className="change-booking">
    {!open ? <button type="button" className="secondary-button" onClick={() => setOpen(true)}>Change time</button> : <section className="change-panel">
      <div className="section-heading"><div><div className="eyebrow">RESCHEDULE SAFELY</div><h3>Choose a new time</h3></div><button type="button" className="inspector-close" aria-label="Close rescheduling" onClick={() => setOpen(false)}>×</button></div>
      <div className="fields second">
        <label>Timezone<select value={timezone} onChange={(event) => { setTimezone(event.target.value); setTime(''); }}>
          {zones.map(([id, label]) => <option value={id} key={id}>{label} ({id})</option>)}
          {!zones.some(([id]) => id === booking.parent.timezone) && <option value={booking.parent.timezone}>{booking.parent.timezone}</option>}
        </select></label>
        <label>Date<input type="date" min={DateTime.now().setZone(timezone).toISODate()!} max={DateTime.now().setZone(timezone).plus({ days: 14 }).toISODate()!} value={date} onChange={(event) => { setDate(event.target.value); setTime(''); }} /></label>
      </div>
      <div className="slots">{slotsQuery.isLoading ? <p className="muted">Checking available times…</p> : slotsQuery.data?.length ? slotsQuery.data.map((item) => <button type="button" key={item.time} className={`slot ${time === item.time ? 'selected' : ''}`} onClick={() => setTime(item.time)}>{item.label}</button>) : <p className="muted">No times available on this date.</p>}</div>
      {message && <p className="hint" role="status">{message}</p>}
      {changeAlternatives.length > 0 && <div className="alternative-slots">{changeAlternatives.map((item) => <button type="button" className="slot" key={item.time} onClick={() => { setTime(item.time); setMessage(''); setChangeAlternatives([]); }}>{item.label}<small>{item.availableMentors} free</small></button>)}</div>}
      <button type="button" className="button" disabled={!time || changeMutation.isPending} onClick={() => changeMutation.mutate()}>{changeMutation.isPending ? 'Updating booking…' : 'Confirm new time'} <span>→</span></button>
    </section>}
    {message && !open && <p className="hint" role="status">{message}</p>}
  </div>;
}

function ConfirmationPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const managementToken = searchParams.get('token') ?? '';
  const query = useQuery({
    queryKey: ['booking', id, managementToken],
    queryFn: () => request<Booking>(`/bookings/${encodeURIComponent(id!)}?token=${encodeURIComponent(managementToken)}`),
    enabled: Boolean(id && managementToken),
  });
  const cancelMutation = useMutation({
    mutationFn: () => request<Booking>(`/bookings/${encodeURIComponent(id!)}/cancel`, { method: 'POST', body: JSON.stringify({ managementToken }) }),
    onSuccess: () => void query.refetch(),
  });

  return <Shell><main className="narrow">
    {!managementToken && <section className="card"><h2>Private booking link required</h2><p>Open the secure change or cancel link from your confirmation email.</p><Link to="/">Back to booking</Link></section>}
    {managementToken && query.isLoading && <div className="card">Loading your booking…</div>}
    {query.isError && <div className="card"><h2>Booking details unavailable</h2><p>{(query.error as Error).message}</p><Link to="/">Back to booking</Link></div>}
    {query.data && <section className={`card success booking-result ${query.data.status === 'CANCELLED' ? 'booking-cancelled' : ''}`}>
      <div className="check">{query.data.status === 'CONFIRMED' ? '✓' : '×'}</div>
      <div className="eyebrow">{query.data.status === 'CANCELLED' ? 'BOOKING CANCELLED' : 'BOOKING CONFIRMED'}</div>
      <h2>{query.data.status === 'CANCELLED' ? 'This class was cancelled.' : 'Your trial class is booked!'}</h2>
      <p>{query.data.status === 'CANCELLED' ? 'The parent and mentor have been notified.' : `We’re looking forward to exploring ${query.data.subject} with ${query.data.parent.name}.`}</p>
      <TimezoneComparison startUtc={query.data.startUtc} parentTimezone={query.data.parent.timezone} mentorTimezone={query.data.mentor.timezone} />
      <MentorProfile name={query.data.mentor.name} timezone={query.data.mentor.timezone} subject={query.data.subject} />
      {query.data.status === 'CONFIRMED' && <>
        <Countdown startUtc={query.data.startUtc} />
        <div className="result-actions"><a className="button" href={query.data.classLink}>Open private classroom <span>↗</span></a><a className="secondary-button" href={`${query.data.classLink}/calendar.ics`}>Add to calendar</a></div>
        <p className="classroom-disclaimer">This booking has its own secure CodeYoung demo classroom. It is a waiting room and does not provide live audio/video yet.</p>
        <ChangeBookingForm booking={query.data} managementToken={managementToken} onChanged={() => void query.refetch()} />
        <button type="button" className="cancel-booking-button owner-cancel" disabled={cancelMutation.isPending} onClick={() => {
          if (window.confirm('Cancel this class? The parent and mentor will receive an update.')) cancelMutation.mutate();
        }}>{cancelMutation.isPending ? 'Cancelling…' : 'Cancel booking'}</button>
        {cancelMutation.isError && <p className="error" role="alert">{(cancelMutation.error as Error).message}</p>}
      </>}
    </section>}
  </main></Shell>;
}

function ClassPage() {
  const { token } = useParams();
  const query = useQuery({
    queryKey: ['classroom', token],
    queryFn: () => request<Classroom>(`/class/${encodeURIComponent(token!)}`),
    enabled: Boolean(token),
    refetchInterval: (query) => query.state.data?.status === 'CONFIRMED' && !query.state.data.classEnded ? 30_000 : false,
  });
  const room = query.data;
  return <Shell><main className="narrow classroom-page">
    {query.isLoading && <div className="card">Opening your private classroom…</div>}
    {query.isError && <div className="card"><h2>Classroom link unavailable</h2><p>{(query.error as Error).message}</p><p className="hint">Classroom links are private. Check your confirmation email for the original link.</p></div>}
    {room && <section className="card classroom-card">
      <div className="eyebrow">CODEYOUNG · PRIVATE DEMO CLASSROOM</div>
      <h1>Welcome{room.parentName ? `, ${room.parentName}` : ''}.</h1>
      <p className="classroom-subtitle">Your {room.subject} session with {room.mentor.name}.</p>
      {room.status === 'CANCELLED' ? <div className="classroom-state state-cancelled" role="status">This class was cancelled. Contact the parent if you need to rebook.</div>
        : room.classEnded ? <div className="classroom-state" role="status">This scheduled class has ended.</div>
          : <>
            <TimezoneComparison startUtc={room.startUtc} parentTimezone={room.parentTimezone} mentorTimezone={room.mentorTimezone} />
            <MentorProfile name={room.mentor.name} timezone={room.mentor.timezone} subject={room.subject} />
            <Countdown startUtc={room.startUtc} />
            <div className={`classroom-state ${room.joinAvailable ? 'state-ready' : ''}`} role="status">
              {room.joinAvailable ? 'Your scheduled class time has arrived. This demo waiting room is open.' : 'Your appointment is confirmed. Please keep this page handy and return at the scheduled time.'}
            </div>
            <p className="classroom-disclaimer">Development classroom only: there is no live audio or video connection. A real Google Meet room requires a configured Google integration; this private room reference is unique to this booking.</p>
            <a className="secondary-button" href={`${room.classroomUrl}/calendar.ics`}>Add to calendar</a>
          </>}
      <Link className="secondary-link" to="/">Return to CodeYoung</Link>
    </section>}
  </main></Shell>;
}

type Admin = {
  metrics: {
    activeMentors: number;
    totalMentors: number;
    classesToday: number;
    dailyCapacity: number;
    availableCapacitySlots: number;
    mentorsAtCapacity: number;
    upcomingBookings: number;
    windowDays: number;
    capacityDate: string | null;
    bookingLimit: number;
    totalBookings: number;
    confirmedBookings: number;
    cancelledBookings: number;
    completedBookings: number;
    bookingsToday: number;
    bookingsThisWeek: number;
    bookingsThisMonth: number;
    cancellationRate: number;
  };
  analytics: {
    subjects: { subject: string; count: number }[];
    peakBookingHours: { hour: string; count: number }[];
    samplePeriodDays: number;
  };
  recentBookings: {
    id: string; status: string; subject: string; parentName: string; mentorName: string;
    startUtc: string; parentTimezone: string; mentorTimezone: string; createdAt: string;
  }[];
  mentors: {
    id: string;
    name: string;
    timezone: string;
    active: boolean;
    subjects: string[];
    bookedToday: number;
    nextClassUtc: string | null;
  }[];
  bookings: {
    id: string;
    status: string;
    subject: string;
    parentName: string;
    parentEmail: string;
    mentorName: string;
    mentorEmail: string;
    startUtc: string;
    parentTimezone: string;
    mentorTimezone: string;
    classLink: string;
    notifications: { recipientType: string; recipientEmail: string; status: string; type: string }[];
  }[];
};

function formatAdminTime(instant: string, timezone: string) {
  const value = DateTime.fromISO(instant, { zone: timezone });
  return value.isValid ? value.toFormat('ccc, LLL d · h:mm a') : 'Time unavailable';
}

function exportBookings(bookings: Admin['bookings']) {
  const rows = [
    ['Parent', 'Mentor', 'Subject', 'Parent local time', 'Mentor local time', 'Status'],
    ...bookings.map((booking) => [
      booking.parentName,
      booking.mentorName,
      booking.subject,
      `${formatAdminTime(booking.startUtc, booking.parentTimezone)} (${booking.parentTimezone})`,
      `${formatAdminTime(booking.startUtc, booking.mentorTimezone)} (${booking.mentorTimezone})`,
      booking.status,
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => {
    const safe = value.replace(/^[=+\-@]/, "'$&");
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `trial-bookings-${DateTime.now().toISODate()}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type AdminSession = { configured: boolean; authenticated: boolean; email?: string };

function AdminPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const session = useQuery({
    queryKey: ['admin-session'],
    queryFn: () => request<AdminSession>('/admin/session'),
    retry: false,
    staleTime: 0,
  });

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      await request('/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setPassword('');
      await session.refetch();
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }

  async function signOut() {
    await request('/admin/logout', { method: 'POST' });
    await session.refetch();
  }

  if (session.isLoading) {
    return <Shell><main className="wrap admin"><div className="admin-panel admin-loading">Checking admin access…</div></main></Shell>;
  }
  if (session.isError) {
    return <Shell><main className="wrap admin"><div className="admin-panel admin-error"><strong>Admin access couldn’t be checked</strong><p>{(session.error as Error).message}</p><button className="refresh-button" onClick={() => void session.refetch()}>Try again</button></div></main></Shell>;
  }
  if (!session.data?.configured) {
    return (
      <Shell>
        <main className="wrap admin">
          <section className="admin-login admin-panel">
            <div className="eyebrow">ADMIN ACCESS</div>
            <h1>Admin login is not configured</h1>
            <p>Add <code>ADMIN_EMAIL</code>, <code>ADMIN_PASSWORD</code>, and <code>ADMIN_SESSION_SECRET</code> to <code>backend/.env</code>, then restart the API.</p>
            <p className="admin-login-hint">Use a password with at least 12 characters and a random session secret with at least 32 characters.</p>
          </section>
        </main>
      </Shell>
    );
  }
  if (!session.data.authenticated) {
    return (
      <Shell>
        <main className="wrap admin">
          <section className="admin-login admin-panel">
            <div className="eyebrow">SECURE OPERATIONS</div>
            <h1>Admin login</h1>
            <p>Sign in to manage mentor availability and trial bookings.</p>
            <form onSubmit={(event) => void signIn(event)}>
              <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {loginError && <div className="admin-login-error" role="alert">{loginError}</div>}
              <button className="button" type="submit" disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign in'} <span>→</span></button>
            </form>
          </section>
        </main>
      </Shell>
    );
  }
  return <AdminDashboard onLogout={() => void signOut()} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [controlError, setControlError] = useState('');
  const [search, setSearch] = useState('');
  const [mentorFilter, setMentorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [capacityDate, setCapacityDate] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedBookingId, setSelectedBookingId] = useState('');
  const q = useQuery({
    queryKey: ['admin', windowDays, capacityDate],
    queryFn: () => {
      const params = new URLSearchParams({ days: String(windowDays) });
      if (capacityDate) params.set('capacityDate', capacityDate);
      return request<Admin>(`/admin?${params.toString()}`);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const mentorMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      request(`/admin/mentors/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
    onSuccess: () => { setControlError(''); void queryClient.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (error) => setControlError((error as Error).message),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => request(`/admin/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    onSuccess: () => { setControlError(''); setSelectedBookingId(''); void queryClient.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (error) => setControlError((error as Error).message),
  });
  const bookings = q.data?.bookings ?? [];
  const filteredBookings = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
      return bookings.filter((booking) => {
        const matchesSearch = !normalizedSearch
          || booking.parentName.toLowerCase().includes(normalizedSearch)
          || booking.mentorName.toLowerCase().includes(normalizedSearch)
          || booking.parentEmail.toLowerCase().includes(normalizedSearch)
          || booking.mentorEmail.toLowerCase().includes(normalizedSearch);
      const matchesMentor = mentorFilter === 'all' || booking.mentorName === mentorFilter;
      const matchesStatus = statusFilter === 'all' || booking.status === statusFilter;
      const matchesDate = !dateFilter
        || DateTime.fromISO(booking.startUtc).setZone(booking.parentTimezone).toISODate() === dateFilter;
      return matchesSearch && matchesMentor && matchesStatus && matchesDate;
    });
  }, [bookings, dateFilter, mentorFilter, search, statusFilter]);
  const selectedBooking = filteredBookings.find((booking) => booking.id === selectedBookingId);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const visibleBookings = filteredBookings.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const endOfUtcToday = DateTime.now().toUTC().endOf('day').toMillis();
  const todaySchedule = bookings.filter((booking) => new Date(booking.startUtc).getTime() <= endOfUtcToday);
  useEffect(() => setPageIndex(0), [dateFilter, mentorFilter, search, statusFilter, windowDays]);

  return (
    <Shell>
      <main className="wrap admin">
        <div className="admin-heading">
          <div>
            <div className="eyebrow">SECURE OPERATIONS</div>
            <h1 className="admin-title">Scheduling overview</h1>
            <p>Signed in as admin · Manage mentor availability and upcoming classes.</p>
          </div>
          <div className="admin-heading-actions">
            <button className="refresh-button" onClick={() => void q.refetch()} disabled={q.isFetching}>
              <span className={q.isFetching ? 'refresh-icon spinning' : 'refresh-icon'}>↻</span>
              {q.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="refresh-button" onClick={onLogout}>Log out</button>
          </div>
        </div>
        {controlError && <div className="admin-control-error" role="alert">{controlError}</div>}
        {q.isLoading ? (
          <div className="admin-panel admin-loading">Loading scheduling data…</div>
        ) : q.isError ? (
          <div className="admin-panel admin-error">
            <strong>Dashboard couldn’t load</strong>
            <p>{(q.error as Error).message}</p>
            <button className="refresh-button" onClick={() => void q.refetch()}>Try again</button>
          </div>
        ) : !q.data ? (
          <div className="admin-panel admin-error">No dashboard data was returned.</div>
        ) : (
          <>
            <section className="admin-section schedule-section">
              <div className="section-heading"><div><div className="eyebrow">TODAY’S UPCOMING CLASSES · UTC</div><h2>Today’s schedule</h2></div><span className="section-note">{todaySchedule.length} scheduled</span></div>
              {todaySchedule.length ? <div className="schedule-list">{todaySchedule.map((booking) => <article className="schedule-item" key={booking.id}>
                <div className="schedule-time">{formatAdminTime(booking.startUtc, booking.parentTimezone)}<small>{booking.parentTimezone}</small></div>
                <div className="schedule-class"><strong>{booking.parentName} <span>with</span> {booking.mentorName}</strong><small>{booking.subject}</small></div>
                <span className="badge">confirmed</span>
              </article>)}</div> : <p className="empty-state">No upcoming classes in the remaining UTC day.</p>}
            </section>
            <div className="admin-stats">
              <article className="admin-stat">
                <span className="stat-icon">♙</span>
                <small>ACTIVE MENTORS</small>
                <strong>{q.data.metrics.activeMentors}<i> / {q.data.metrics.totalMentors}</i></strong>
                <span className="stat-caption">Active mentors available for assignment</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">◷</span>
                <small>{q.data.metrics.capacityDate ? `CLASSES · ${q.data.metrics.capacityDate}` : 'CLASSES TODAY'}</small>
                <strong>{q.data.metrics.classesToday}<i> / {q.data.metrics.dailyCapacity}</i></strong>
                <span className="stat-caption">Counted in each mentor’s local day</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">▦</span>
                <small>UPCOMING · {q.data.metrics.windowDays} DAYS</small>
                <strong>{q.data.metrics.upcomingBookings}</strong>
                <span className="stat-caption">Confirmed trial classes</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">＋</span>
                <small>CAPACITY REMAINING</small>
                <strong>{q.data.metrics.availableCapacitySlots}</strong>
                <span className="stat-caption">Across active mentors for the selected local day</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">✓</span>
                <small>MENTORS AT DAILY LIMIT</small>
                <strong>{q.data.metrics.mentorsAtCapacity}</strong>
                <span className="stat-caption">Two classes booked for the selected local day</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">▣</span>
                <small>ALL BOOKINGS</small>
                <strong>{q.data.metrics.totalBookings}</strong>
                <span className="stat-caption">Stored in the booking database</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">↗</span>
                <small>CONFIRMED</small>
                <strong>{q.data.metrics.confirmedBookings}</strong>
                <span className="stat-caption">Including completed times</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">×</span>
                <small>CANCELLED</small>
                <strong>{q.data.metrics.cancelledBookings}</strong>
                <span className="stat-caption">{q.data.metrics.cancellationRate}% of all bookings</span>
              </article>
              <article className="admin-stat">
                <span className="stat-icon">◷</span>
                <small>BOOKED THIS WEEK · UTC</small>
                <strong>{q.data.metrics.bookingsThisWeek}</strong>
                <span className="stat-caption">{q.data.metrics.bookingsThisMonth} so far this month</span>
              </article>
            </div>
            <section className="admin-section analytics-section">
              <div className="section-heading"><div><div className="eyebrow">REAL BOOKING DATA</div><h2>Trial class analytics</h2></div><span className="section-note">Last {q.data.analytics.samplePeriodDays} days for peak times</span></div>
              <div className="analytics-grid">
                <div className="analytics-block"><h3>Course interest</h3>
                  {q.data.analytics.subjects.length ? q.data.analytics.subjects.map((item) => {
                    const max = Math.max(...q.data.analytics.subjects.map((value) => value.count));
                    return <div className="bar-row" key={item.subject}><span>{item.subject}</span><div className="analytics-track"><i style={{ width: `${Math.max(4, item.count / max * 100)}%` }} /></div><b>{item.count}</b></div>;
                  }) : <p className="muted">No booking data yet.</p>}
                </div>
                <div className="analytics-block"><h3>Popular parent local start times</h3>
                  {q.data.analytics.peakBookingHours.length ? q.data.analytics.peakBookingHours.map((item) => {
                    const max = Math.max(...q.data.analytics.peakBookingHours.map((value) => value.count));
                    return <div className="bar-row" key={item.hour}><span>{item.hour}</span><div className="analytics-track"><i style={{ width: `${Math.max(4, item.count / max * 100)}%` }} /></div><b>{item.count}</b></div>;
                  }) : <p className="muted">No booking data yet.</p>}
                </div>
              </div>
              <p className="admin-footnote">Today, week, and month totals use UTC. Mentor capacity and daily load use each mentor’s local calendar day.</p>
            </section>
            <section className="admin-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">CAPACITY BY LOCAL DAY</div>
                  <h2>Mentor availability</h2>
                </div>
                <div className="capacity-date-control">
                  <label htmlFor="capacity-date">Capacity date</label>
                  <input id="capacity-date" type="date" value={capacityDate} onChange={(event) => setCapacityDate(event.target.value)} />
                  {capacityDate && <button onClick={() => setCapacityDate('')}>Today</button>}
                </div>
              </div>
              <div className="mentor-grid">
                {q.data.mentors.map((mentor) => {
                  const utilization = Math.min(100, mentor.bookedToday / 2 * 100);
                  const selectedDayPassed = Boolean(capacityDate
                    && DateTime.fromISO(capacityDate, { zone: mentor.timezone }).endOf('day') < DateTime.now().setZone(mentor.timezone));
                  return (
                    <article className={`mentor-card ${mentor.active ? '' : 'mentor-card-inactive'}`} key={mentor.id}>
                      <div className="mentor-card-top">
                        <div className="mentor-avatar">{mentor.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
                        <div className="mentor-identity">
                          <b>{mentor.name} <span className={`mentor-state ${mentor.active ? 'mentor-state-active' : ''}`}>{mentor.active ? 'Active' : 'Inactive'}</span></b>
                          <span>{mentor.timezone}</span>
                          <span className="mentor-subjects">{mentor.subjects.join(' · ') || 'No courses assigned'}</span>
                        </div>
                        <strong className={`capacity-count ${mentor.bookedToday >= 2 ? 'capacity-full' : ''}`}>
                          {mentor.bookedToday}<small>/ 2</small>
                        </strong>
                      </div>
                      <div className={`capacity-track ${mentor.bookedToday >= 2 ? 'capacity-track-full' : ''}`}>
                        <span style={{ width: `${utilization}%` }} />
                      </div>
                      <div className="mentor-card-bottom">
                        <span>{!mentor.active ? 'Not assigned new bookings' : mentor.bookedToday >= 2 ? 'At daily limit' : selectedDayPassed ? 'Selected day has passed' : `${2 - mentor.bookedToday} spots available`}</span>
                        {mentor.nextClassUtc && <span>Next · {formatAdminTime(mentor.nextClassUtc, mentor.timezone)}</span>}
                      </div>
                      <button className="mentor-toggle" disabled={mentorMutation.isPending} onClick={() => mentorMutation.mutate({ id: mentor.id, active: !mentor.active })}>
                        {mentorMutation.isPending && mentorMutation.variables?.id === mentor.id ? 'Saving…' : mentor.active ? 'Disable mentor' : 'Enable mentor'}
                      </button>
                    </article>
                  );
                })}
              </div>
              <p className="admin-footnote">
                {capacityDate ? `Capacity uses ${capacityDate} in each mentor’s timezone.` : 'Today is calculated separately in each mentor’s timezone.'}
                {' '}Counts include classes already completed on that local day.
              </p>
            </section>

            <section className="admin-section booking-section">
              <div className="section-heading booking-heading">
                <div>
                  <div className="eyebrow">NEXT {q.data.metrics.windowDays} DAYS</div>
                  <h2>Upcoming bookings</h2>
                  <p>
                    {filteredBookings.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filteredBookings.length)}` : '0'}
                    {' '}of {filteredBookings.length} matching · {q.data.metrics.upcomingBookings} total
                  </p>
                </div>
                <div className="booking-actions">
                  <label className="window-control">
                    <span>Window</span>
                    <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                    </select>
                  </label>
                  <button className="export-button" onClick={() => exportBookings(filteredBookings)} disabled={!filteredBookings.length}>
                    ↓ Export CSV
                  </button>
                </div>
              </div>

              <div className="booking-filters">
                <label className="search-field">
                  <span>⌕</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search parent or mentor" />
                </label>
                <select aria-label="Filter by mentor" value={mentorFilter} onChange={(event) => setMentorFilter(event.target.value)}>
                  <option value="all">All mentors</option>
                  {q.data.mentors.map((mentor) => <option key={mentor.id} value={mentor.name}>{mentor.name}</option>)}
                </select>
                <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="CONFIRMED">Confirmed</option>
                </select>
                <label className="date-filter">
                  <span>Parent local date</span>
                  <input aria-label="Filter by parent local date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
                </label>
                {(search || mentorFilter !== 'all' || statusFilter !== 'all' || dateFilter) && (
                  <button className="clear-filters" onClick={() => { setSearch(''); setMentorFilter('all'); setStatusFilter('all'); setDateFilter(''); }}>
                    Clear filters
                  </button>
                )}
              </div>

              <div className="table-wrap admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Parent</th><th>Mentor</th><th>Course</th><th>Parent local time</th><th>Mentor local time</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {visibleBookings.map((booking) => (
                      <tr key={booking.id}>
                        <td><strong>{booking.parentName}</strong></td>
                        <td>{booking.mentorName}</td>
                        <td>{booking.subject}</td>
                        <td><strong>{formatAdminTime(booking.startUtc, booking.parentTimezone)}</strong><small>{booking.parentTimezone}</small></td>
                        <td><strong>{formatAdminTime(booking.startUtc, booking.mentorTimezone)}</strong><small>{booking.mentorTimezone}</small></td>
                        <td><span className="badge">{booking.status.toLowerCase()}</span></td>
                        <td><button className="inspect-button" onClick={() => setSelectedBookingId(booking.id)}>Details</button></td>
                      </tr>
                    ))}
                    {!filteredBookings.length && (
                      <tr><td className="empty-results" colSpan={7}>No bookings match these filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {q.data.metrics.upcomingBookings > q.data.bookings.length && (
                <p className="admin-footnote">Showing up to {q.data.metrics.bookingLimit} upcoming bookings. Refine the date window or search to narrow the results.</p>
              )}
              {pageCount > 1 && (
                <div className="pagination">
                  <button className="refresh-button" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>← Previous</button>
                  <span>Page {currentPage + 1} of {pageCount}</span>
                  <button className="refresh-button" disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex(currentPage + 1)}>Next →</button>
                </div>
              )}
              {selectedBooking && (
                <aside className="booking-inspector">
                  <div className="inspector-heading">
                    <div>
                      <div className="eyebrow">BOOKING DETAILS</div>
                      <h3>{selectedBooking.parentName} <span>with</span> {selectedBooking.mentorName}</h3>
                    </div>
                    <button className="inspector-close" aria-label="Close booking details" onClick={() => setSelectedBookingId('')}>×</button>
                  </div>
                  <div className="inspector-grid">
                    <div><small>PARENT CONTACT</small><a href={`mailto:${selectedBooking.parentEmail}`}>{selectedBooking.parentEmail}</a></div>
                    <div><small>MENTOR CONTACT</small><a href={`mailto:${selectedBooking.mentorEmail}`}>{selectedBooking.mentorEmail}</a></div>
                    <div><small>PARENT LOCAL TIME</small><strong>{formatAdminTime(selectedBooking.startUtc, selectedBooking.parentTimezone)}</strong><span>{selectedBooking.parentTimezone}</span></div>
                    <div><small>MENTOR LOCAL TIME</small><strong>{formatAdminTime(selectedBooking.startUtc, selectedBooking.mentorTimezone)}</strong><span>{selectedBooking.mentorTimezone}</span></div>
                  </div>
                  <div className="inspector-bottom">
                    <div className="delivery-statuses">
                      <strong>Email delivery</strong>
                      {selectedBooking.notifications.map((notification) => (
                        <span key={notification.recipientType} className={`delivery-chip delivery-${notification.status.toLowerCase()}`}>
                          {notification.recipientType.toLowerCase()}: {notification.status.toLowerCase()}
                        </span>
                      ))}
                    </div>
                    <a className="inspect-link" href={selectedBooking.classLink} target="_blank" rel="noreferrer">Open class details ↗</a>
                    <button className="cancel-booking-button" disabled={cancelMutation.isPending} onClick={() => {
                      if (window.confirm(`Cancel the trial class for ${selectedBooking.parentName} with ${selectedBooking.mentorName}?`)) {
                        cancelMutation.mutate(selectedBooking.id);
                      }
                    }}>{cancelMutation.isPending ? 'Cancelling…' : 'Cancel booking'}</button>
                  </div>
                </aside>
              )}
            </section>
            <section className="admin-section recent-section">
              <div className="section-heading"><div><div className="eyebrow">LATEST RECORDS</div><h2>Recent booking activity</h2></div></div>
              {q.data.recentBookings.length ? <div className="table-wrap admin-table-wrap"><table className="admin-table recent-table">
                <thead><tr><th>Parent</th><th>Course</th><th>Mentor</th><th>Scheduled parent time</th><th>Status</th></tr></thead>
                <tbody>{q.data.recentBookings.map((booking) => <tr key={booking.id}>
                  <td><strong>{booking.parentName}</strong><small>Created {DateTime.fromISO(booking.createdAt).toFormat('LLL d, h:mm a')}</small></td>
                  <td>{booking.subject}</td><td>{booking.mentorName}</td>
                  <td><strong>{formatAdminTime(booking.startUtc, booking.parentTimezone)}</strong><small>{booking.parentTimezone}</small></td>
                  <td><span className={`badge status-${booking.status.toLowerCase()}`}>{booking.status.toLowerCase()}</span></td>
                </tr>)}</tbody>
              </table></div> : <p className="empty-state">No booking activity yet.</p>}
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingPage />} />
      <Route path="/booking/:id" element={<ConfirmationPage />} />
      <Route path="/class/:token" element={<ClassPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<BookingPage />} />
    </Routes>
  );
}
