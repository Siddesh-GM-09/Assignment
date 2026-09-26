import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { PrismaClient } from '@prisma/client';
import { BookingService } from '../../src/services/bookingService.js';

const db = new PrismaClient();
const service = new BookingService(db);
const mentorTimezone = 'Asia/Kolkata';

beforeAll(async () => {
  await db.notification.deleteMany();
  await db.booking.deleteMany();
  await db.parent.deleteMany();
  await db.mentor.deleteMany();
  await db.mentor.create({
    data: { name: 'Test Mentor', email: 'mentor@example.com', timezone: mentorTimezone },
  });
});

afterAll(async () => db.$disconnect());

describe('booking flow', () => {
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
    expect((await service.byToken(booking.classToken)).id).toBe(booking.id);
    await expect(service.get('missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.byToken('invalid')).rejects.toMatchObject({ status: 404 });
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

    await expect(
      service.create({
        name: 'Another Parent',
        email: 'other@example.com',
        timezone: mentorTimezone,
        date: localDay,
        time: '14:00',
      }),
    ).rejects.toMatchObject({ code: 'NO_MENTOR_AVAILABLE' });
  });
});
