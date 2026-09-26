import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { assertTimezone, formatInZone, localDayRange, localToUtc } from '../utils/time.js';

export class BookingService {
  constructor(private db: PrismaClient) {}

  async slots(date: string, zone: string) {
    assertTimezone(zone);
    const day = DateTime.fromISO(date, { zone });
    if (!day.isValid) throw new AppError('INVALID_DATE', 'Choose a valid date.', 422);

    const today = DateTime.now().setZone(zone).startOf('day');
    if (day.startOf('day') < today || day.startOf('day') > today.plus({ days: config.bookingWindowDays })) {
      throw new AppError('DATE_OUT_OF_RANGE', `Choose a date within the next ${config.bookingWindowDays} days.`, 422);
    }

    const slots: Array<{ time: string; label: string; availableMentors: number }> = [];
    for (let hour = config.businessStartHour; hour + config.slotDurationMinutes / 60 <= config.businessEndHour; hour++) {
      const local = day.set({ hour, minute: 0, second: 0, millisecond: 0 });
      if (!local.isValid || local.toISODate() !== date) continue;

      const start = local.toUTC().toJSDate();
      const end = local.plus({ minutes: config.slotDurationMinutes }).toUTC().toJSDate();
      if (start <= new Date()) continue;

      const eligible = await this.db.mentor.findMany({
        where: {
          active: true,
          bookings: {
            none: {
              status: 'CONFIRMED',
              scheduledStartUtc: { lt: end },
              scheduledEndUtc: { gt: start },
            },
          },
        },
      });

      let withCapacity = 0;
      for (const m of eligible) {
        const range = localDayRange(start, m.timezone);
        const n = await this.db.booking.count({
          where: {
            mentorId: m.id,
            status: 'CONFIRMED',
            scheduledStartUtc: { gte: range.start, lt: range.end },
          },
        });
        if (n < 2) withCapacity += 1;
      }

      if (withCapacity > 0) {
        slots.push({
          time: local.toFormat('HH:mm'),
          label: local.toFormat('h:mm a'),
          availableMentors: withCapacity,
        });
      }
    }
    return slots;
  }

  async create(input: { name: string; email: string; timezone: string; date: string; time: string; idempotencyKey?: string }) {
    assertTimezone(input.timezone);
    const start = localToUtc(input.date, input.time, input.timezone);
    if (start <= new Date()) throw new AppError('PAST_BOOKING', 'Choose a future time.', 422);

    const end = new Date(start.getTime() + config.slotDurationMinutes * 60000);
    if (input.idempotencyKey) {
      const old = await this.db.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (old) return this.get(old.id);
    }

    try {
      return await this.db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const overlap = await tx.booking.findMany({
            where: {
              status: 'CONFIRMED',
              scheduledStartUtc: { lt: end },
              scheduledEndUtc: { gt: start },
            },
            include: { mentor: true },
          });

          const mentors = await tx.mentor.findMany({
            where: { active: true },
            orderBy: { id: 'asc' },
          });

          const eligible: Array<{ mentor: (typeof mentors)[number]; count: number }> = [];
          for (const mentor of mentors) {
            if (overlap.some((booking) => booking.mentorId === mentor.id)) continue;
            const range = localDayRange(start, mentor.timezone);
            const count = await tx.booking.count({
              where: {
                mentorId: mentor.id,
                status: 'CONFIRMED',
                scheduledStartUtc: { gte: range.start, lt: range.end },
              },
            });
            if (count < 2) eligible.push({ mentor, count });
          }

          eligible.sort((a, b) => a.count - b.count || a.mentor.id.localeCompare(b.mentor.id));
          if (!eligible.length) {
            throw new AppError('NO_MENTOR_AVAILABLE', 'This time slot is no longer available. Please choose another time.', 409);
          }

          const mentor = eligible[0]!.mentor;
          const parent = await tx.parent.upsert({
            where: { email: input.email.toLowerCase() },
            update: { name: input.name, timezone: input.timezone },
            create: { name: input.name, email: input.email.toLowerCase(), timezone: input.timezone },
          });

          const token = randomBytes(24).toString('base64url');
          const origin = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

          const booking = await tx.booking.create({
            data: {
              parentId: parent.id,
              mentorId: mentor.id,
              scheduledStartUtc: start,
              scheduledEndUtc: end,
              parentTimezone: input.timezone,
              mentorTimezone: mentor.timezone,
              status: 'CONFIRMED',
              classToken: token,
              idempotencyKey: input.idempotencyKey,
              classLink: `${origin}/class/${token}`,
            },
          });

          await tx.notification.createMany({
            data: [
              {
                bookingId: booking.id,
                recipientType: 'PARENT',
                recipientEmail: parent.email,
                type: 'BOOKING_CONFIRMED',
                message: `Your trial class is booked for ${formatInZone(start, input.timezone)}. ${booking.classLink}`,
              },
              {
                bookingId: booking.id,
                recipientType: 'MENTOR',
                recipientEmail: mentor.email,
                type: 'MENTOR_ASSIGNED',
                message: `New trial class assigned for ${formatInZone(start, mentor.timezone)}. ${booking.classLink}`,
              },
            ],
          });

          console.info(JSON.stringify({ event: 'booking_confirmed', bookingId: booking.id, mentorId: mentor.id }));
          return this.get(booking.id, tx);
        },
        { timeout: 10000 }
      );
    } catch (e: unknown) {
      if (e instanceof AppError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (input.idempotencyKey) {
          const existing = await this.db.booking.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (existing) return this.get(existing.id);
        }
        throw new AppError('BOOKING_CONFLICT', 'This request was already processed or the slot changed. Refresh available times.', 409);
      }
      throw e;
    }
  }

  async get(id: string, db: PrismaClient | Prisma.TransactionClient = this.db) {
    const b = await db.booking.findUnique({
      where: { id },
      include: { parent: true, mentor: true, notifications: true },
    });
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', 404);

    return {
      id: b.id,
      status: b.status,
      parent: { name: b.parent.name, email: b.parent.email, timezone: b.parentTimezone },
      mentor: { name: b.mentor.name, timezone: b.mentorTimezone },
      startUtc: b.scheduledStartUtc.toISOString(),
      endUtc: b.scheduledEndUtc.toISOString(),
      parentTime: formatInZone(b.scheduledStartUtc, b.parentTimezone),
      mentorTime: formatInZone(b.scheduledStartUtc, b.mentorTimezone),
      classLink: b.classLink,
      notifications: b.notifications.map((n) => ({
        recipientType: n.recipientType,
        email: n.recipientEmail,
        status: n.status,
      })),
    };
  }

  async byToken(token: string) {
    const b = await this.db.booking.findUnique({ where: { classToken: token } });
    if (!b) throw new AppError('CLASS_NOT_FOUND', 'This demo class link is invalid or expired.', 404);
    return this.get(b.id);
  }
}
