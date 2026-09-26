import { useState } from 'react';
import { Link, Route, Routes, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { request } from './services/api';
import type { Booking, Slot } from './types';

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
          <Link to="/admin">Demo admin</Link>
        </nav>
      </header>
      {children}
      <footer>
        Made for curious minds <span>·</span> A complimentary 1:1 trial class
      </footer>
    </>
  );
}

function BookingPage() {
  const navigate = useNavigate();
  const guessed = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(zones.some((z) => z[0] === guessed) ? guessed : 'America/New_York');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const slotQuery = useQuery({
    queryKey: ['slots', date, timezone],
    queryFn: () => request<Slot[]>(`/slots?date=${date}&timezone=${encodeURIComponent(timezone)}`),
  });

  const minDate = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await request<Booking>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ ...form, timezone, date, time: slot, idempotencyKey: crypto.randomUUID() }),
      });
      navigate(`/booking/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again.');
      setSlot('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <main className="wrap">
        <section className="hero">
          <div>
            <div className="eyebrow"><i /> COMPLIMENTARY TRIAL CLASS</div>
            <h1>Big ideas start<br />with <em>one great class.</em></h1>
            <p>Meet your child’s next favorite teacher. Choose a time that works for your family and we’ll take care of the rest.</p>
            <div className="hero-note"><span>✦</span> Personalised learning, one-on-one</div>
          </div>
          <div className="art">
            <div className="orb orb1" />
            <div className="orb orb2" />
            <div className="book">✳</div>
            <div className="bubble">A little<br />curiosity goes<br /><b>a long way!</b></div>
            <div className="pill">Learn at your pace</div>
          </div>
        </section>

        {booking ? (
          <section className="card success">
            <div className="check">✓</div>
            <div className="eyebrow">YOU’RE ALL SET</div>
            <h2>Trial class confirmed!</h2>
            <p>We’re excited to meet {booking.parent.name}. Your teacher is ready.</p>
            <div className="detail-grid">
              <div>
                <small>YOUR TIME · {booking.parent.timezone}</small>
                <strong>{booking.parentTime}</strong>
              </div>
              <div>
                <small>YOUR MENTOR</small>
                <strong>{booking.mentor.name}</strong>
                <span>{booking.mentorTime}</span>
                <small>MENTOR LOCAL TIME · {booking.mentor.timezone}</small>
              </div>
            </div>
            <a className="button" href={booking.classLink}>
              Join demo class <span>↗</span>
            </a>
            <p className="hint">Your class link is ready to use. A confirmation has been recorded for both you and your mentor.</p>
            <button className="linkbutton" onClick={() => setBooking(null)}>Book another class</button>
          </section>
        ) : (
          <form className="card" onSubmit={submit}>
            <div className="cardhead">
              <div>
                <div className="eyebrow">LET’S FIND YOUR TIME</div>
                <h2>Book a free trial</h2>
              </div>
              <div className="step">01 <span>/ 01</span></div>
            </div>
            <div className="fields">
              <label>
                Your name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="e.g. Jordan Lee"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Email address
                <input
                  required
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
            </div>
            <div className="fields second">
              <label>
                Your timezone
                <select
                  value={timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    setSlot('');
                  }}
                >
                  {zones.map(([id, label]) => (
                    <option value={id} key={id}>{label} ({id})</option>
                  ))}
                </select>
              </label>
              <label>
                Choose a date
                <input
                  type="date"
                  min={minDate}
                  max={maxDate}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot('');
                  }}
                />
              </label>
            </div>
            <div className="slotheading">
              <div><b>Pick a time</b><span> · shown in your local timezone</span></div>
              <span className="tzchip">◷ {timezone}</span>
            </div>
            <div className="slots">
              {slotQuery.isLoading ? (
                <p className="muted">Finding available times…</p>
              ) : slotQuery.isError ? (
                <p className="error">
                  {(slotQuery.error as Error).message}{' '}
                  <button type="button" className="linkbutton" onClick={() => void slotQuery.refetch()}>
                    Retry
                  </button>
                </p>
              ) : slotQuery.data?.length ? (
                slotQuery.data.map((s) => (
                  <button
                    type="button"
                    key={s.time}
                    className={`slot ${slot === s.time ? 'selected' : ''}`}
                    onClick={() => setSlot(s.time)}
                  >
                    {s.label}
                  </button>
                ))
              ) : (
                <p className="muted">No times available on this date. Try another day.</p>
              )}
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
            <button className="button full" disabled={!slot || loading}>
              {loading ? 'Booking your class…' : 'Confirm trial class'} <span>→</span>
            </button>
            <div className="privacy">No payment needed <span>·</span> Your mentor may be in a different timezone</div>
          </form>
        )}
      </main>
    </Shell>
  );
}

function ConfirmationPage() {
  const { id } = useParams();

  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => request<Booking>(`/bookings/${id}`),
    enabled: Boolean(id),
  });

  return (
    <Shell>
      <main className="narrow">
        {query.isLoading && <div className="card">Loading your booking…</div>}

        {query.isError && (
          <div className="card">
            <h2>Booking not found</h2>
            <p>{(query.error as Error).message}</p>
            <Link to="/">Back to booking</Link>
          </div>
        )}

        {query.data && (
          <section className="card success">
            <div className="check">✓</div>
            <div className="eyebrow">BOOKING CONFIRMED</div>
            <h2>Your trial class is booked!</h2>
            <p>Your mentor is {query.data.mentor.name}.</p>

            <div className="detail-grid">
              <div>
                <small>YOUR LOCAL TIME · {query.data.parent.timezone}</small>
                <strong>{query.data.parentTime}</strong>
              </div>
              <div>
                <small>MENTOR LOCAL TIME · {query.data.mentor.timezone}</small>
                <strong>{query.data.mentorTime}</strong>
              </div>
            </div>

            <a className="button" href={query.data.classLink}>
              Open demo class <span>↗</span>
            </a>
            <p className="hint">Status: {query.data.status}</p>
          </section>
        )}
      </main>
    </Shell>
  );
}

function ClassPage() {
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['class', token],
    queryFn: () => request<Booking>(`/class/${token}`),
    enabled: Boolean(token),
  });

  return (
    <Shell>
      <main className="narrow">
        {q.isLoading ? (
          <div className="card">Loading your class…</div>
        ) : q.isError ? (
          <div className="card">
            <h2>Class link unavailable</h2>
            <p>{(q.error as Error).message}</p>
          </div>
        ) : (
          <div className="card success">
            <div className="check">✳</div>
            <div className="eyebrow">YOUR CLASSROOM</div>
            <h2>Your demo class is ready.</h2>
            <p>Welcome, {q.data?.parent.name}! Your mentor {q.data?.mentor.name} is expecting you.</p>
            <div className="detail-grid">
              <div>
                <small>YOUR LOCAL TIME</small>
                <strong>{q.data?.parentTime}</strong>
              </div>
              <div>
                <small>MENTOR LOCAL TIME</small>
                <strong>{q.data?.mentorTime}</strong>
                <span>{q.data?.mentor.name}</span>
              </div>
            </div>
            <Link className="button" to="/">
              Back to booking <span>→</span>
            </Link>
            <p className="hint">This is a demonstration classroom; no video connection is required.</p>
          </div>
        )}
      </main>
    </Shell>
  );
}

type Admin = {
  mentors: {
    id: string;
    name: string;
    timezone: string;
    bookings: { id: string; startUtc: string; parentTimezone: string; parentName: string }[];
  }[];
  todayCount: number;
  bookings: {
    id: string;
    status: string;
    parentName: string;
    mentorName: string;
    startUtc: string;
    parentTimezone: string;
    mentorTimezone: string;
  }[];
};

function AdminPage() {
  const q = useQuery({
    queryKey: ['admin'],
    queryFn: () => request<Admin>('/admin'),
  });

  return (
    <Shell>
      <main className="wrap admin">
        <div className="eyebrow">OPERATIONS · DEMO ONLY</div>
        <h1 className="admin-title">Scheduling overview</h1>
        <p>A transparent view of mentor capacity and upcoming trial classes.</p>
        {q.isLoading ? (
          <p>Loading dashboard…</p>
        ) : q.isError ? (
          <p className="error">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="stats">
              <div>
                <small>ACTIVE MENTORS</small>
                <strong>{q.data?.mentors.length}</strong>
              </div>
              <div>
                <small>BOOKINGS TODAY · UTC</small>
                <strong>{q.data?.todayCount}</strong>
              </div>
              <div>
                <small>UPCOMING BOOKINGS</small>
                <strong>{q.data?.bookings.length}</strong>
              </div>
            </div>
            <h2>Mentor utilization</h2>
            <div className="mentor-grid">
              {q.data?.mentors.map((m) => (
                <article className="mentor" key={m.id}>
                  <div>
                    <b>{m.name}</b>
                    <span>{m.timezone}</span>
                  </div>
                  <div className="capacity">
                    <span>{m.bookings.length} upcoming</span>
                    <span>{Math.max(0, 2 - m.bookings.length)} daily spots left*</span>
                  </div>
                </article>
              ))}
            </div>
            <small className="hint">* Capacity varies by each mentor’s local calendar day and selected time.</small>
            <h2>Recent bookings</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Parent</th>
                    <th>Mentor</th>
                    <th>Appointment · UTC</th>
                    <th>Zones</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.bookings.map((b) => (
                    <tr key={b.id}>
                      <td>{b.parentName}</td>
                      <td>{b.mentorName}</td>
                      <td>{new Date(b.startUtc).toLocaleString()}</td>
                      <td>
                        {b.parentTimezone}<br />{b.mentorTimezone}
                      </td>
                      <td>
                        <span className="badge">{b.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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