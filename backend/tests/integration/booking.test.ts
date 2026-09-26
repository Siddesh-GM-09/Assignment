import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { app } from '../../src/app.js';
import { BookingService } from '../../src/services/bookingService.js';

const db = new PrismaClient();
const service = new BookingService(db);
const mentorTimezone = 'Asia/Kolkata';
let adminCookie = '';

beforeAll(async () => {
  await db.notification.deleteMany();
  await db.booking.deleteMany();
  await db.parent.deleteMany();
  await db.mentor.deleteMany();
  await db.mentor.create({
    data: { name: 'Test Mentor', email: 'mentor@example.com', timezone: mentorTimezone },
  });
  for (const subject of ['Coding', 'Creative AI', 'Robotics', 'Math Puzzles']) {
    await db.mentorSubject.create({ data: { mentorId: (await db.mentor.findFirstOrThrow()).id, subject } });
  }
  const login = await request(app).post('/api/admin/login').send({
    email: 'admin-test@example.com',
    password: 'Test-only-admin-password-123!',
  });
  expect(login.status).toBe(200);
  adminCookie = login.headers['set-cookie'][0].split(';')[0];
});

afterAll(async () => db.$disconnect());

describe('booking flow', () => {
  it('requires a valid admin session for protected routes', async () => {
    const session = await request(app).get('/api/admin/session');
    expect(session.body.data).toMatchObject({ configured: true, authenticated: false });
    expect((await request(app).get('/api/admin')).status).toBe(401);
    const invalidLogin = await request(app).post('/api/admin/login').send({
      email: 'admin-test@example.com',
      password: 'incorrect-password',
    });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body.error.message).toBe('Email or password is incorrect.');
    expect((await request(app).get('/api/admin').set('Cookie', adminCookie)).status).toBe(200);
  });

  it('assigns a mentor, records notifications, and returns local times', async () => {
    const date = DateTime.now().plus({ days: 1 }).toISODate()!;
    const input = {
      name: 'Taylor Parent',
      email: 'parent@example.com',
      timezone: 'America/New_York',
      date,
      time: '18:00',
      idempotencyKey: `booking-${Date.now()}`,
    };
    const result = await service.create(input);
    const retry = await service.create(input);

    expect(retry.id).toBe(result.id);
    expect(result.mentor.name).toBe('Test Mentor');
    expect(result.notifications).toHaveLength(2);
    expect(result.classLink).toContain('/class/');
    expect(result.mentorTime).toContain('AM');
  });

  it('retrieves a booking and its class using the opaque token', async () => {
    const booking = await db.booking.findFirstOrThrow();
    expect((await service.get(booking.id)).id).toBe(booking.id);
    const room = await service.byToken(booking.classToken);
    expect(room.id).toBe(booking.id);
    expect('parentEmail' in room).toBe(false);
    await expect(service.get('missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.byToken('invalid')).rejects.toMatchObject({ status: 404 });
    expect((await request(app).get(`/api/bookings/${booking.id}`)).status).toBe(403);
    expect((await request(app).get(`/api/bookings/${booking.id}?token=${booking.manageToken}`)).status).toBe(200);
    const roomResponse = await request(app).get(`/api/class/${booking.classToken}`);
    expect(roomResponse.body.data).toMatchObject({ id: booking.id, meetingProvider: 'INTERNAL_CLASSROOM' });
    expect(roomResponse.body.data.parentEmail).toBeUndefined();
    const calendar = await request(app).get(`/api/class/${booking.classToken}/calendar.ics`);
    expect(calendar.status).toBe(200);
    expect(calendar.text).toContain('BEGIN:VCALENDAR');
    expect(calendar.text).toContain(booking.classLink);
  });

  it('creates a unique internal classroom and a backend-ranked recommendation', async () => {
    const first = await service.create({
      name: 'Room Parent One', email: 'room-one@example.com', timezone: mentorTimezone,
      date: DateTime.now().setZone(mentorTimezone).plus({ days: 6 }).toISODate()!, time: '09:00',
    });
    const second = await service.create({
      name: 'Room Parent Two', email: 'room-two@example.com', timezone: mentorTimezone,
      date: DateTime.now().setZone(mentorTimezone).plus({ days: 7 }).toISODate()!, time: '09:00',
    });
    expect(first.classLink).not.toBe(second.classLink);
    expect(first.meetingProvider).toBe('INTERNAL_CLASSROOM');
    expect(first.classLink).toMatch(/\/class\/[A-Za-z0-9_-]{40,}$/);
    expect(first.managementToken).toHaveLength(43);
    expect(second.managementToken).not.toBe(first.managementToken);

    const date = DateTime.now().setZone(mentorTimezone).plus({ days: 8 }).toISODate()!;
    const response = await request(app).get(`/api/recommendations?date=${date}&timezone=${mentorTimezone}&subject=Coding`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommended).toMatchObject({ date, mentorTimezone, availableMentors: 1 });
    expect(response.body.data.recommended.reason).toBeTruthy();
    expect(Array.isArray(response.body.data.alternatives)).toBe(true);
    expect((await request(app).get(`/api/slots?date=${date}&timezone=Not/AZone`)).status).toBe(422);
  });

  it('enforces two classes on the mentor local calendar day', async () => {
    const mentor = await db.mentor.findFirstOrThrow();
    const localDay = DateTime.now().setZone(mentorTimezone).plus({ days: 3 }).toISODate()!;
    const parent = await db.parent.findFirstOrThrow();

    for (const hour of [9, 11]) {
      const localStart = DateTime.fromISO(`${localDay}T${String(hour).padStart(2, '0')}:00`, {
        zone: mentorTimezone,
      });
      await db.booking.create({
        data: {
          parentId: parent.id,
          mentorId: mentor.id,
          scheduledStartUtc: localStart.toUTC().toJSDate(),
          scheduledEndUtc: localStart.plus({ hours: 1 }).toUTC().toJSDate(),
          parentTimezone: 'UTC',
          mentorTimezone,
          classToken: `seed-${hour}-${Date.now()}`,
          classLink: 'http://localhost/class',
        },
      });
    }

    expect(await service.slots(localDay, mentorTimezone)).toHaveLength(0);

    await expect(
      service.create({
        name: 'Another Parent',
        email: 'other@example.com',
        timezone: mentorTimezone,
        date: localDay,
        time: '14:00',
      }),
    ).rejects.toMatchObject({ code: 'NO_MENTOR_AVAILABLE', status: 409 });
  });

  it('never assigns more than two same-day classes when bookings arrive together', async () => {
    const mentor = await db.mentor.findFirstOrThrow();
    const localDay = DateTime.now().setZone(mentorTimezone).plus({ days: 5 }).toISODate()!;
    const attempts = [9, 11, 13].map((hour, index) =>
      service.create({
        name: `Concurrent Parent ${index}`,
        email: `concurrent-${Date.now()}-${index}@example.com`,
        timezone: mentorTimezone,
        date: localDay,
        time: `${String(hour).padStart(2, '0')}:00`,
        idempotencyKey: `concurrent-${Date.now()}-${index}`,
      }),
    );

    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'NO_MENTOR_AVAILABLE', status: 409 } });
    expect(await db.booking.count({
      where: {
        mentorId: mentor.id,
        status: 'CONFIRMED',
        scheduledStartUtc: {
          gte: DateTime.fromISO(`${localDay}T00:00`, { zone: mentorTimezone }).toUTC().toJSDate(),
          lt: DateTime.fromISO(`${localDay}T00:00`, { zone: mentorTimezone }).plus({ days: 1 }).toUTC().toJSDate(),
        },
      },
    })).toBe(2);
  });

  it('returns accurate, bounded admin metrics and bookings', async () => {
    const capacityDate = DateTime.now().setZone(mentorTimezone).toISODate()!;
    const response = await request(app).get(`/api/admin?days=14&capacityDate=${capacityDate}`).set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.metrics).toMatchObject({
      activeMentors: 1,
      dailyCapacity: 2,
      mentorsAtCapacity: 0,
      windowDays: 14,
      capacityDate,
      bookingLimit: 1000,
    });
    expect(response.body.data.mentors).toHaveLength(1);
    expect(response.body.data.mentors[0]).toMatchObject({
      name: 'Test Mentor',
      timezone: mentorTimezone,
      bookedToday: 0,
      nextClassUtc: null,
    });
    expect(response.body.data.bookings.length).toBeLessThanOrEqual(response.body.data.metrics.bookingLimit);
    expect(response.body.data.bookings).toEqual(
      [...response.body.data.bookings].sort((a: { startUtc: string }, b: { startUtc: string }) =>
        a.startUtc.localeCompare(b.startUtc)),
    );
    expect(response.body.data.bookings.every((booking: { parentTimezone: string; mentorTimezone: string }) =>
      Boolean(booking.parentTimezone && booking.mentorTimezone)),
    ).toBe(true);

    expect((await request(app).get('/api/admin?days=8').set('Cookie', adminCookie)).status).toBe(422);
    expect((await request(app).get('/api/admin?capacityDate=2026-02-30').set('Cookie', adminCookie)).status).toBe(422);
  });

  it('allows an admin to disable and re-enable a mentor', async () => {
    const mentor = await db.mentor.findFirstOrThrow();
    const disabled = await request(app).patch(`/api/admin/mentors/${mentor.id}`).set('Cookie', adminCookie).send({ active: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data).toEqual({ id: mentor.id, active: false });
    const dashboard = await request(app).get('/api/admin').set('Cookie', adminCookie);
    expect(dashboard.body.data.metrics.activeMentors).toBe(0);
    expect(dashboard.body.data.mentors[0].active).toBe(false);
    const enabled = await request(app).patch(`/api/admin/mentors/${mentor.id}`).set('Cookie', adminCookie).send({ active: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.active).toBe(true);
  });

  it('lets an admin cancel a confirmed booking and frees its slot', async () => {
    const localDay = DateTime.now().setZone(mentorTimezone).plus({ days: 9 }).toISODate()!;
    const booking = await service.create({
      name: 'Cancellation Parent',
      email: 'cancel-parent@example.com',
      timezone: mentorTimezone,
      date: localDay,
      time: '09:00',
      idempotencyKey: `cancel-${Date.now()}`,
    });
    const response = await request(app).post(`/api/admin/bookings/${booking.id}/cancel`).set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELLED');
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
    expect((await service.slots(localDay, mentorTimezone)).some((slot) => slot.time === '09:00')).toBe(true);
    expect((await request(app).post(`/api/admin/bookings/${booking.id}/cancel`).set('Cookie', adminCookie)).status).toBe(409);
    const room = await request(app).get(`/api/class/${booking.classLink.split('/').pop()}`);
    expect(room.body.data).toMatchObject({ status: 'CANCELLED', joinAvailable: false });
  });

  it('lets the parent reschedule with the private management token and notifies both recipients', async () => {
    const day = DateTime.now().setZone(mentorTimezone).plus({ days: 10 }).toISODate()!;
    const booking = await service.create({
      name: 'Reschedule Parent', email: 'reschedule-parent@example.com', timezone: mentorTimezone,
      date: day, time: '09:00', idempotencyKey: `reschedule-${Date.now()}`,
    });
    const nextDate = DateTime.now().setZone(mentorTimezone).plus({ days: 11 }).toISODate()!;
    const response = await request(app).post(`/api/bookings/${booking.id}/reschedule`).send({
      managementToken: booking.managementToken, date: nextDate, time: '10:00', timezone: mentorTimezone,
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'CONFIRMED', startUtc: DateTime.fromISO(`${nextDate}T10:00`, { zone: mentorTimezone }).toUTC().toISO() });
    expect(response.body.data.classLink).toBe(booking.classLink);
    expect(response.body.data.managementToken).toBe(booking.managementToken);
    expect(await db.bookingReschedule.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await db.notification.count({ where: { bookingId: booking.id, type: 'BOOKING_RESCHEDULED' } })).toBe(2);
    expect((await request(app).post(`/api/bookings/${booking.id}/cancel`).send({ managementToken: booking.managementToken })).status).toBe(200);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  });

  it('reports database-backed health and admin analytics', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ status: 'ok', database: 'ok' });
    expect(health.body.data.timestamp).toBeTruthy();
    const dashboard = await request(app).get('/api/admin?days=14').set('Cookie', adminCookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.metrics).toMatchObject({ totalBookings: expect.any(Number), cancelledBookings: expect.any(Number), bookingsThisWeek: expect.any(Number) });
    expect(dashboard.body.data.analytics.subjects.length).toBeGreaterThan(0);
    expect(dashboard.body.data.recentBookings.length).toBeGreaterThan(0);
  });
});
