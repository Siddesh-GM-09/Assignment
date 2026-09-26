import type { Request, Response } from 'express';
import { DateTime } from 'luxon';
import { prisma } from '../config/database.js';
import { supportedSubjects } from '../config/subjects.js';
import { BookingService } from '../services/bookingService.js';
import {
  adminMentorSchema,
  adminSchema,
  bookingSchema,
  managedBookingSchema,
  recommendationsSchema,
  rescheduleSchema,
  slotsSchema,
} from '../validators/booking.js';
import { AppError } from '../errors/AppError.js';
import { localDayRange } from '../utils/time.js';

export const bookingService = new BookingService(prisma);
const adminBookingLimit = 1000;

export async function health(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString(), database: 'ok', version: '1.0.0' } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'The service is running but the database is unavailable.' }, data: { status: 'degraded', timestamp: new Date().toISOString(), database: 'unavailable' } });
  }
}

export function timezones(_req: Request, res: Response) {
  res.json({ success: true, data: [...Intl.supportedValuesOf('timeZone')].map((id) => ({ id, label: id.replaceAll('_', ' ') })) });
}

export async function slots(req: Request, res: Response) {
  const parsed = slotsSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'A valid date, timezone, and course are required.', 422);
  res.json({ success: true, data: await bookingService.slots(parsed.data.date, parsed.data.timezone, parsed.data.subject) });
}

export async function recommendations(req: Request, res: Response) {
  const parsed = recommendationsSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'A valid date, timezone, and course are required.', 422);
  res.json({ success: true, data: await bookingService.recommendations(parsed.data.date, parsed.data.timezone, parsed.data.subject) });
}

export async function createBooking(req: Request, res: Response) {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.', 422);
  res.status(201).json({ success: true, data: await bookingService.create(parsed.data) });
}

function routeToken(req: Request) {
  const token = req.query.token;
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
    throw new AppError('BOOKING_ACCESS_DENIED', 'A valid booking management link is required.', 403);
  }
  return token;
}

export async function getBooking(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('VALIDATION_ERROR', 'A booking ID is required.', 400);
  res.json({ success: true, data: await bookingService.getManaged(id, routeToken(req)) });
}

export async function rescheduleBooking(req: Request, res: Response) {
  const id = req.params.id;
  const parsed = rescheduleSchema.safeParse(req.body);
  if (typeof id !== 'string' || !parsed.success) throw new AppError('VALIDATION_ERROR', 'Choose a valid date, time, timezone, and booking token.', 422);
  const { managementToken, ...input } = parsed.data;
  res.json({ success: true, data: await bookingService.reschedule(id, managementToken, input) });
}

export async function cancelBooking(req: Request, res: Response) {
  const id = req.params.id;
  const parsed = managedBookingSchema.safeParse(req.body);
  if (typeof id !== 'string' || !parsed.success) throw new AppError('VALIDATION_ERROR', 'A valid booking token is required.', 422);
  res.json({ success: true, data: await bookingService.cancel(id, parsed.data.managementToken) });
}

export async function getClass(req: Request, res: Response) {
  const token = req.params.token;
  if (typeof token !== 'string') throw new AppError('VALIDATION_ERROR', 'A classroom token is required.', 400);
  res.json({ success: true, data: await bookingService.classroomByToken(token) });
}

export async function getClassCalendar(req: Request, res: Response) {
  const token = req.params.token;
  if (typeof token !== 'string') throw new AppError('VALIDATION_ERROR', 'A classroom token is required.', 400);
  const calendar = await bookingService.addToCalendar(token);
  const details = await bookingService.classroomByToken(token);
  if (details.status !== 'CONFIRMED') throw new AppError('BOOKING_NOT_CONFIRMED', 'A cancelled class cannot be added to a calendar.', 409);
  res.type('text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="codeyoung-trial-${details.id.replace(/[^a-zA-Z0-9-]/g, '')}.ics"`);
  res.send(calendar);
}

export async function admin(req: Request, res: Response) {
  const parsed = adminSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Choose a 7, 14, or 30 day window and a valid capacity date.', 422);
  const { days, capacityDate } = parsed.data;
  const now = new Date();
  const windowEnd = DateTime.fromJSDate(now).plus({ days }).toJSDate();
  const mentors = await prisma.mentor.findMany({
    select: { id: true, name: true, timezone: true, active: true, subjects: { select: { subject: true }, orderBy: { subject: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  const mentorRanges = mentors.map((mentor) => {
    const selectedDay = capacityDate ? DateTime.fromISO(capacityDate, { zone: mentor.timezone }) : null;
    if (selectedDay && (!selectedDay.isValid || selectedDay.toISODate() !== capacityDate)) {
      throw new AppError('INVALID_DATE', 'Choose a valid capacity date.', 422);
    }
    const dayStart = selectedDay?.startOf('day').toJSDate() ?? now;
    return { mentor, range: localDayRange(dayStart, mentor.timezone) };
  });
  const todayBookings = mentorRanges.length
    ? await prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        OR: mentorRanges.map(({ mentor, range }) => ({
          mentorId: mentor.id,
          scheduledStartUtc: { gte: range.start, lt: range.end },
        })),
      },
      select: { id: true, mentorId: true, scheduledStartUtc: true },
    })
    : [];

  const upcomingWhere = { status: 'CONFIRMED', scheduledStartUtc: { gte: now, lt: windowEnd } };
  const utcToday = DateTime.now().toUTC().startOf('day');
  const weekStart = utcToday.startOf('week');
  const monthStart = utcToday.startOf('month');
  const [upcomingCount, bookings, recentBookings, totalBookings, confirmedBookings, cancelledBookings, completedBookings, bookingsToday, bookingsThisWeek, bookingsThisMonth, subjects, loadSample] = await Promise.all([
    prisma.booking.count({ where: upcomingWhere }),
    prisma.booking.findMany({
      where: upcomingWhere,
      select: {
        id: true, status: true, subject: true, scheduledStartUtc: true, parentTimezone: true, mentorTimezone: true,
        classLink: true, parent: { select: { name: true, email: true } }, mentor: { select: { name: true, email: true } },
        notifications: { select: { recipientType: true, recipientEmail: true, status: true, type: true }, orderBy: { recipientType: 'asc' } },
      },
      orderBy: { scheduledStartUtc: 'asc' },
      take: adminBookingLimit,
    }),
    prisma.booking.findMany({
      take: 8, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, subject: true, scheduledStartUtc: true, parentTimezone: true, mentorTimezone: true, createdAt: true, parent: { select: { name: true } }, mentor: { select: { name: true } } },
    }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.booking.count({ where: { status: 'CANCELLED' } }),
    prisma.booking.count({ where: { OR: [{ status: 'COMPLETED' }, { status: 'CONFIRMED', scheduledEndUtc: { lt: now } }] } }),
    prisma.booking.count({ where: { scheduledStartUtc: { gte: utcToday.toJSDate(), lt: utcToday.plus({ days: 1 }).toJSDate() } } }),
    prisma.booking.count({ where: { scheduledStartUtc: { gte: weekStart.toJSDate(), lt: utcToday.plus({ days: 1 }).toJSDate() } } }),
    prisma.booking.count({ where: { scheduledStartUtc: { gte: monthStart.toJSDate(), lt: utcToday.plus({ days: 1 }).toJSDate() } } }),
    prisma.booking.groupBy({ by: ['subject'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    prisma.booking.findMany({ where: { status: 'CONFIRMED', scheduledStartUtc: { gte: DateTime.now().minus({ days: 30 }).toJSDate(), lt: now } }, select: { scheduledStartUtc: true, parentTimezone: true }, take: 5000 }),
  ]);

  const mentorStats = mentorRanges.map(({ mentor }) => {
    const dayBookings = todayBookings.filter((booking) => booking.mentorId === mentor.id).sort((a, b) => a.scheduledStartUtc.getTime() - b.scheduledStartUtc.getTime());
    return {
      id: mentor.id,
      name: mentor.name,
      timezone: mentor.timezone,
      active: mentor.active,
      subjects: mentor.subjects.map((item) => item.subject),
      bookedToday: dayBookings.length,
      nextClassUtc: dayBookings.find((booking) => booking.scheduledStartUtc >= now)?.scheduledStartUtc.toISOString() ?? null,
    };
  });
  const activeMentorIds = new Set(mentors.filter((mentor) => mentor.active).map((mentor) => mentor.id));
  const activeDayBookings = todayBookings.filter((booking) => activeMentorIds.has(booking.mentorId));
  const hourCounts = new Map<number, number>();
  for (const booking of loadSample) {
    const localHour = DateTime.fromJSDate(booking.scheduledStartUtc, { zone: booking.parentTimezone }).hour;
    hourCounts.set(localHour, (hourCounts.get(localHour) ?? 0) + 1);
  }
  const peakBookingHours = [...hourCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([hour, count]) => ({
    hour: DateTime.utc().set({ hour }).toFormat('h a'),
    count,
  }));

  const mapBooking = (booking: typeof bookings[number]) => ({
    id: booking.id,
    status: booking.status,
    subject: booking.subject,
    parentName: booking.parent.name,
    mentorName: booking.mentor.name,
    mentorEmail: booking.mentor.email,
    parentEmail: booking.parent.email,
    startUtc: booking.scheduledStartUtc.toISOString(),
    parentTimezone: booking.parentTimezone,
    mentorTimezone: booking.mentorTimezone,
    classLink: booking.classLink,
    notifications: booking.notifications,
  });

  res.json({
    success: true,
    data: {
      metrics: {
        activeMentors: activeMentorIds.size,
        totalMentors: mentors.length,
        classesToday: activeDayBookings.length,
        dailyCapacity: activeMentorIds.size * 2,
        availableCapacitySlots: Math.max(0, activeMentorIds.size * 2 - activeDayBookings.length),
        mentorsAtCapacity: mentorStats.filter((mentor) => mentor.active && mentor.bookedToday >= 2).length,
        upcomingBookings: upcomingCount,
        windowDays: days,
        capacityDate: capacityDate ?? null,
        bookingLimit: adminBookingLimit,
        totalBookings,
        confirmedBookings,
        cancelledBookings,
        completedBookings,
        bookingsToday,
        bookingsThisWeek,
        bookingsThisMonth,
        cancellationRate: totalBookings ? Math.round(cancelledBookings / totalBookings * 100) : 0,
      },
      mentors: mentorStats,
      bookings: bookings.map(mapBooking),
      recentBookings: recentBookings.map((booking) => ({
        id: booking.id, status: booking.status, subject: booking.subject,
        parentName: booking.parent.name, mentorName: booking.mentor.name,
        startUtc: booking.scheduledStartUtc.toISOString(), parentTimezone: booking.parentTimezone,
        mentorTimezone: booking.mentorTimezone, createdAt: booking.createdAt.toISOString(),
      })),
      analytics: {
        subjects: subjects.map((item) => ({ subject: item.subject, count: item._count.id })),
        peakBookingHours,
        samplePeriodDays: 30,
      },
      bookingSubjects: supportedSubjects,
    },
  });
}

export async function setMentorActive(req: Request, res: Response) {
  const id = req.params.id;
  const parsed = adminMentorSchema.safeParse(req.body);
  if (typeof id !== 'string' || !parsed.success) throw new AppError('VALIDATION_ERROR', 'Provide a mentor ID and an active state.', 422);
  const existing = await prisma.mentor.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('NOT_FOUND', 'Mentor not found.', 404);
  const mentor = await prisma.mentor.update({ where: { id }, data: { active: parsed.data.active }, select: { id: true, active: true } });
  res.json({ success: true, data: mentor });
}

export async function cancelAdminBooking(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string' || !id) throw new AppError('VALIDATION_ERROR', 'A booking ID is required.', 422);
  res.json({ success: true, data: await bookingService.cancel(id, undefined, true) });
}
