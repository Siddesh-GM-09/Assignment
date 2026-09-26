import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { supportedSubjects, type Subject } from '../config/subjects.js';
import { AppError } from '../errors/AppError.js';
import { assertTimezone, formatInZone, localDayRange, localToUtc } from '../utils/time.js';
import { isEmailConfigured, sendBookingEmail, type BookingEmail } from './emailService.js';
import { InternalClassroomProvider } from './meetingProvider.js';

export type BookingInput = {
  name: string;
  email: string;
  timezone: string;
  date: string;
  time: string;
  subject?: Subject;
  idempotencyKey?: string;
};
export type SlotOption = {
  time: string;
  label: string;
  availableMentors: number;
  lightestMentorLoad: number;
};

type MentorCandidate = { id: string; name: string; email: string; timezone: string; load: number };
type SlotCandidates = { option: SlotOption; start: Date; end: Date; mentors: MentorCandidate[] };
type NotificationSnapshot = Omit<BookingEmail, 'recipientType' | 'recipientEmail'>;

const classroomProvider = new InternalClassroomProvider(config.publicAppUrl);

function secureEqual(left: string, right: string) {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

export class BookingService {
  constructor(private db: PrismaClient) {}

  async slots(date: string, zone: string, subject: Subject = 'Coding'): Promise<SlotOption[]> {
    return (await this.slotCandidates(date, zone, subject)).map(({ option }) => option);
  }

  async recommendations(date: string, zone: string, subject: Subject = 'Coding') {
    const candidates = await this.slotCandidates(date, zone, subject);
    const ranked = [...candidates].sort((a, b) => {
      const aAfterSchool = this.afterSchoolScore(a.option.time);
      const bAfterSchool = this.afterSchoolScore(b.option.time);
      return a.option.lightestMentorLoad - b.option.lightestMentorLoad
        || b.option.availableMentors - a.option.availableMentors
        || bAfterSchool - aAfterSchool
        || a.start.getTime() - b.start.getTime();
    });
    const activeCourseMentors = ranked.length ? null : await this.db.mentor.count({ where: { active: true, subjects: { some: { subject } } } });
    const toRecommendation = (candidate: SlotCandidates) => {
      const mentor = candidate.mentors[0];
      const localParent = DateTime.fromJSDate(candidate.start, { zone });
      return {
        date: localParent.toISODate(),
        time: candidate.option.time,
        label: candidate.option.label,
        startUtc: candidate.start.toISOString(),
        endUtc: candidate.end.toISOString(),
        parentTimezone: zone,
        parentLocalTime: formatInZone(candidate.start, zone),
        mentorTimezone: mentor?.timezone ?? null,
        mentorLocalTime: mentor ? formatInZone(candidate.start, mentor.timezone) : null,
        availableMentors: candidate.option.availableMentors,
        reason: candidate.option.lightestMentorLoad === 0
          ? 'The available mentor with the lightest schedule has no other classes on their local day.'
          : candidate.option.availableMentors > 1
            ? 'Several mentors are free, and the lightest current daily load is prioritized.'
            : 'This is the lightest available mentor schedule for the selected date.',
      };
    };

    return {
      recommended: ranked[0] ? toRecommendation(ranked[0]) : null,
      alternatives: ranked.slice(1, 4).map(toRecommendation),
      message: ranked.length ? undefined : activeCourseMentors
        ? 'All active mentors for this course are booked at the available times. Try another date.'
        : `No active mentors are currently assigned to ${subject}. Please choose another course or contact support.`,
    };
  }

  private afterSchoolScore(time: string) {
    const hour = Number(time.slice(0, 2));
    return hour >= 15 && hour <= 19 ? 1 : 0;
  }

  private async slotCandidates(date: string, zone: string, subject: Subject): Promise<SlotCandidates[]> {
    assertTimezone(zone);
    this.assertSubject(subject);
    const selectedDay = DateTime.fromISO(date, { zone });
    if (!selectedDay.isValid || selectedDay.toISODate() !== date) {
      throw new AppError('INVALID_DATE', 'Choose a valid date.', 422);
    }
    this.assertBookingWindow(date, zone);

    const mentors = await this.db.mentor.findMany({
      where: { active: true, subjects: { some: { subject } } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, email: true, timezone: true },
    });
    if (!mentors.length) return [];

    const rawSlots: Array<{ time: string; label: string; start: Date; end: Date }> = [];
    const duration = config.slotDurationMinutes;
    for (let minuteOfDay = config.businessStartHour * 60; minuteOfDay + duration <= config.businessEndHour * 60; minuteOfDay += duration) {
      const local = selectedDay.set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60, second: 0, millisecond: 0 });
      if (!local.isValid || local.toISODate() !== date) continue;
      const start = local.toUTC().toJSDate();
      if (start <= new Date()) continue;
      rawSlots.push({
        time: local.toFormat('HH:mm'),
        label: local.toFormat('h:mm a'),
        start,
        end: local.plus({ minutes: duration }).toUTC().toJSDate(),
      });
    }
    if (!rawSlots.length) return [];

    const rangeByKey = new Map<string, { mentorId: string; start: Date; end: Date }>();
    for (const slot of rawSlots) {
      for (const mentor of mentors) {
        const range = localDayRange(slot.start, mentor.timezone);
        rangeByKey.set(`${mentor.id}:${range.start.toISOString()}`, { mentorId: mentor.id, ...range });
      }
    }
    const ranges = [...rangeByKey.values()];
    const [dailyBookings, overlappingBookings] = await Promise.all([
      this.db.booking.findMany({
        where: { status: 'CONFIRMED', OR: ranges.map((range) => ({ mentorId: range.mentorId, scheduledStartUtc: { gte: range.start, lt: range.end } })) },
        select: { id: true, mentorId: true, scheduledStartUtc: true, scheduledEndUtc: true },
      }),
      this.db.booking.findMany({
        where: {
          status: 'CONFIRMED',
          scheduledStartUtc: { lt: rawSlots[rawSlots.length - 1]!.end },
          scheduledEndUtc: { gt: rawSlots[0]!.start },
        },
        select: { id: true, mentorId: true, scheduledStartUtc: true, scheduledEndUtc: true },
      }),
    ]);

    return rawSlots.flatMap((slot) => {
      const availableMentors = mentors.flatMap((mentor) => {
        const overlaps = overlappingBookings.some((booking) => booking.mentorId === mentor.id
          && booking.scheduledStartUtc < slot.end && booking.scheduledEndUtc > slot.start);
        if (overlaps) return [];
        const range = localDayRange(slot.start, mentor.timezone);
        const load = dailyBookings.filter((booking) => booking.mentorId === mentor.id
          && booking.scheduledStartUtc >= range.start && booking.scheduledStartUtc < range.end).length;
        return load < 2 ? [{ ...mentor, load }] : [];
      }).sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
      if (!availableMentors.length) return [];
      return [{
        start: slot.start,
        end: slot.end,
        mentors: availableMentors,
        option: {
          time: slot.time,
          label: slot.label,
          availableMentors: availableMentors.length,
          lightestMentorLoad: availableMentors[0]!.load,
        },
      }];
    });
  }

  async create(input: BookingInput) {
    const subject = input.subject ?? 'Coding';
    assertTimezone(input.timezone);
    this.assertSubject(subject);
    const start = localToUtc(input.date, input.time, input.timezone);
    this.assertBookingWindow(input.date, input.timezone);
    this.assertOfferedTime(start, input.date, input.timezone);
    if (start <= new Date()) throw new AppError('PAST_BOOKING', 'Choose a future time.', 422);
    const end = new Date(start.getTime() + config.slotDurationMinutes * 60_000);

    if (input.idempotencyKey) {
      const old = await this.db.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { parent: true } });
      if (old) {
        if (old.parent.email !== input.email.toLowerCase()
          || old.parent.name !== input.name
          || old.parentTimezone !== input.timezone
          || old.scheduledStartUtc.getTime() !== start.getTime()
          || old.subject !== subject) {
          throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different booking.', 409);
        }
        await this.deliverNotificationEmails(old.id);
        return { ...(await this.get(old.id)), managementToken: old.manageToken };
      }
    }

    let bookingId = '';
    let managementToken = '';
    try {
      bookingId = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
        const mentor = await this.assignMentor(tx, start, end, subject);
        const parent = await tx.parent.upsert({
          where: { email: input.email.toLowerCase() },
          update: { name: input.name, timezone: input.timezone },
          create: { name: input.name, email: input.email.toLowerCase(), timezone: input.timezone },
        });
        const classToken = randomBytes(32).toString('base64url');
        managementToken = randomBytes(32).toString('base64url');
        const room = classroomProvider.createRoom(classToken);
        const booking = await tx.booking.create({
          data: {
            parentId: parent.id,
            mentorId: mentor.id,
            scheduledStartUtc: start,
            scheduledEndUtc: end,
            parentTimezone: input.timezone,
            mentorTimezone: mentor.timezone,
            status: 'CONFIRMED',
            subject,
            meetingProvider: room.provider,
            classToken,
            manageToken: managementToken,
            idempotencyKey: input.idempotencyKey,
            classLink: room.url,
          },
        });
        const snapshot = this.notificationSnapshot({
          event: 'CONFIRMED', bookingId: booking.id, subject,
          parentName: parent.name, parentEmail: parent.email, parentTimezone: input.timezone,
          mentorName: mentor.name, mentorEmail: mentor.email, mentorTimezone: mentor.timezone,
          start, classLink: room.url, manageToken: managementToken,
        });
        await this.createNotifications(tx, booking.id, [
          { recipientType: 'PARENT', recipientEmail: parent.email, type: 'BOOKING_CONFIRMED', snapshot },
          { recipientType: 'MENTOR', recipientEmail: mentor.email, type: 'MENTOR_ASSIGNED', snapshot },
        ]);
        console.info(JSON.stringify({ event: 'booking_confirmed', bookingId: booking.id, mentorId: mentor.id }));
        return booking.id;
      }, { timeout: 10_000 });
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === 'NO_MENTOR_AVAILABLE') {
        const alternatives = (await this.slots(input.date, input.timezone, subject)).filter((slot) => slot.time !== input.time).slice(0, 3);
        const activeMentors = await this.db.mentor.count({ where: { active: true, subjects: { some: { subject } } } });
        const message = alternatives.length
          ? 'This time just filled. Choose one of these available times instead.'
          : activeMentors
            ? 'All mentors for this course are at capacity for the selected date. Try another date.'
            : `No active mentors are currently assigned to ${subject}. Please choose another course or contact support.`;
        throw new AppError(error.code, message, error.status, { alternatives });
      }
      if (error instanceof AppError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (input.idempotencyKey) {
          const existing = await this.db.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { parent: true } });
          if (existing && existing.parent.email === input.email.toLowerCase()
            && existing.parent.name === input.name
            && existing.parentTimezone === input.timezone
            && existing.scheduledStartUtc.getTime() === start.getTime()
            && existing.subject === subject) {
            await this.deliverNotificationEmails(existing.id);
            return { ...(await this.get(existing.id)), managementToken: existing.manageToken };
          }
        }
        throw new AppError('BOOKING_CONFLICT', 'This request was already processed or the slot changed. Refresh available times.', 409);
      }
      throw error;
    }

    await this.deliverNotificationEmails(bookingId);
    return { ...(await this.get(bookingId)), managementToken };
  }

  async reschedule(id: string, managementToken: string, input: { date: string; time: string; timezone: string; subject?: Subject }) {
    const current = await this.managedBooking(id, managementToken);
    if (current.status !== 'CONFIRMED') throw new AppError('BOOKING_NOT_CONFIRMED', 'Only confirmed bookings can be changed.', 409);
    const timezone = input.timezone || current.parentTimezone;
    assertTimezone(timezone);
    const subject = input.subject ?? current.subject as Subject;
    this.assertSubject(subject);
    const nextStart = localToUtc(input.date, input.time, timezone);
    this.assertBookingWindow(input.date, timezone);
    this.assertOfferedTime(nextStart, input.date, timezone);
    if (nextStart <= new Date()) throw new AppError('PAST_BOOKING', 'Choose a future time.', 422);
    const nextEnd = new Date(nextStart.getTime() + config.slotDurationMinutes * 60_000);

    try {
      await this.db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({ where: { id }, include: { parent: true, mentor: true } });
        if (!booking || !booking.manageToken || !secureEqual(booking.manageToken, managementToken)) {
          throw new AppError('BOOKING_ACCESS_DENIED', 'This booking management link is invalid or expired.', 403);
        }
        if (booking.status !== 'CONFIRMED') throw new AppError('BOOKING_NOT_CONFIRMED', 'Only confirmed bookings can be changed.', 409);
        const nextMentor = await this.assignMentor(tx, nextStart, nextEnd, subject, id);
        const updated = await tx.booking.update({
          where: { id },
          data: {
            mentorId: nextMentor.id,
            scheduledStartUtc: nextStart,
            scheduledEndUtc: nextEnd,
            parentTimezone: timezone,
            mentorTimezone: nextMentor.timezone,
            subject,
          },
        });
        await tx.bookingReschedule.create({
          data: {
            bookingId: id,
            previousStartUtc: booking.scheduledStartUtc,
            nextStartUtc: nextStart,
            previousMentorName: booking.mentor.name,
            nextMentorName: nextMentor.name,
          },
        });
        const nextSnapshot = this.notificationSnapshot({
          event: 'RESCHEDULED', bookingId: id, subject,
          parentName: booking.parent.name, parentEmail: booking.parent.email, parentTimezone: timezone,
          mentorName: nextMentor.name, mentorEmail: nextMentor.email, mentorTimezone: nextMentor.timezone,
          start: nextStart, classLink: booking.classLink, manageToken: booking.manageToken,
        });
        const notices = [
          { recipientType: 'PARENT', recipientEmail: booking.parent.email, type: 'BOOKING_RESCHEDULED', snapshot: nextSnapshot },
          { recipientType: 'MENTOR', recipientEmail: nextMentor.email, type: 'BOOKING_RESCHEDULED', snapshot: nextSnapshot },
        ];
        if (booking.mentorId !== nextMentor.id) {
          const oldSnapshot = this.notificationSnapshot({
            event: 'CANCELLED', bookingId: id, subject: booking.subject,
            parentName: booking.parent.name, parentEmail: booking.parent.email, parentTimezone: booking.parentTimezone,
            mentorName: booking.mentor.name, mentorEmail: booking.mentor.email, mentorTimezone: booking.mentorTimezone,
            start: booking.scheduledStartUtc, classLink: booking.classLink, manageToken: undefined,
          });
          notices.push({ recipientType: 'MENTOR', recipientEmail: booking.mentor.email, type: 'MENTOR_UNASSIGNED', snapshot: oldSnapshot });
        }
        await this.createNotifications(tx, updated.id, notices);
      }, { timeout: 10_000 });
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === 'NO_MENTOR_AVAILABLE') {
        const alternatives = (await this.slots(input.date, timezone, subject)).filter((slot) => slot.time !== input.time).slice(0, 3);
        const message = alternatives.length
          ? 'This time is no longer available. Choose one of these available times instead.'
          : 'No mentors have capacity for this course on the selected date. Choose another date.';
        throw new AppError(error.code, message, error.status, { alternatives });
      }
      throw error;
    }

    await this.deliverNotificationEmails(id);
    return { ...(await this.get(id)), managementToken };
  }

  async cancel(id: string, managementToken?: string, admin = false) {
    await this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id }, include: { parent: true, mentor: true } });
      if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
      if (!admin && (!managementToken || !booking.manageToken || !secureEqual(booking.manageToken, managementToken))) {
        throw new AppError('BOOKING_ACCESS_DENIED', 'This booking management link is invalid or expired.', 403);
      }
      if (booking.status !== 'CONFIRMED') throw new AppError('BOOKING_NOT_CONFIRMED', 'This booking has already changed and can no longer be cancelled.', 409);
      const changed = await tx.booking.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (!changed.count) throw new AppError('BOOKING_NOT_CONFIRMED', 'This booking has already changed and can no longer be cancelled.', 409);
      const snapshot = this.notificationSnapshot({
        event: 'CANCELLED', bookingId: id, subject: booking.subject,
        parentName: booking.parent.name, parentEmail: booking.parent.email, parentTimezone: booking.parentTimezone,
        mentorName: booking.mentor.name, mentorEmail: booking.mentor.email, mentorTimezone: booking.mentorTimezone,
        start: booking.scheduledStartUtc, classLink: booking.classLink, manageToken: booking.manageToken ?? undefined,
      });
      await this.createNotifications(tx, id, [
        { recipientType: 'PARENT', recipientEmail: booking.parent.email, type: 'BOOKING_CANCELLED', snapshot },
        { recipientType: 'MENTOR', recipientEmail: booking.mentor.email, type: 'BOOKING_CANCELLED', snapshot },
      ]);
    });
    await this.deliverNotificationEmails(id);
    return this.get(id);
  }

  private assertBookingWindow(date: string, timezone: string) {
    const selectedDay = DateTime.fromISO(date, { zone: timezone });
    const today = DateTime.now().setZone(timezone).startOf('day');
    if (!selectedDay.isValid || selectedDay.toISODate() !== date) throw new AppError('INVALID_DATE', 'Choose a valid date.', 422);
    if (selectedDay.startOf('day') < today || selectedDay.startOf('day') > today.plus({ days: config.bookingWindowDays })) {
      throw new AppError('DATE_OUT_OF_RANGE', `Choose a date within the next ${config.bookingWindowDays} days.`, 422);
    }
  }

  private assertSubject(subject: string): asserts subject is Subject {
    if (!supportedSubjects.includes(subject as Subject)) throw new AppError('INVALID_SUBJECT', 'Choose a supported course.', 422);
  }

  private assertOfferedTime(start: Date, date: string, timezone: string) {
    const local = DateTime.fromJSDate(start, { zone: timezone });
    const minute = local.hour * 60 + local.minute;
    const startMinute = config.businessStartHour * 60;
    const endMinute = config.businessEndHour * 60;
    if (local.toISODate() !== date || local.second !== 0 || local.millisecond !== 0
      || (minute - startMinute) % config.slotDurationMinutes !== 0
      || minute < startMinute || minute + config.slotDurationMinutes > endMinute) {
      throw new AppError('INVALID_SLOT', 'Choose one of the available class times.', 422);
    }
    const first = Math.floor(startMinute / config.slotDurationMinutes) * config.slotDurationMinutes;
    if (minute < first) throw new AppError('INVALID_SLOT', 'Choose one of the available class times.', 422);
  }

  private async assignMentor(db: Prisma.TransactionClient, start: Date, end: Date, subject: Subject, excludeBookingId?: string) {
    const mentors = await db.mentor.findMany({
      where: { active: true, subjects: { some: { subject } } },
      orderBy: { id: 'asc' },
    });
    if (!mentors.length) throw new AppError('NO_MENTOR_AVAILABLE', 'There are no mentors available for this course.', 409);
    const exclusion = excludeBookingId ? { id: { not: excludeBookingId } } : {};
    const overlapping = await db.booking.findMany({
      where: {
        ...exclusion,
        status: 'CONFIRMED',
        scheduledStartUtc: { lt: end },
        scheduledEndUtc: { gt: start },
      },
      select: { mentorId: true },
    });
    const loadByMentor = await Promise.all(mentors.map(async (mentor) => {
      const range = localDayRange(start, mentor.timezone);
      const count = await db.booking.count({
        where: {
          ...exclusion,
          mentorId: mentor.id,
          status: 'CONFIRMED',
          scheduledStartUtc: { gte: range.start, lt: range.end },
        },
      });
      return { mentor, count };
    }));
    const eligible = loadByMentor
      .filter(({ mentor, count }) => count < 2 && !overlapping.some((booking) => booking.mentorId === mentor.id))
      .sort((a, b) => a.count - b.count || a.mentor.id.localeCompare(b.mentor.id));
    if (!eligible.length) throw new AppError('NO_MENTOR_AVAILABLE', 'This time slot is no longer available. Please choose another time.', 409);
    return eligible[0]!.mentor;
  }

  private notificationSnapshot(input: {
    event: NotificationSnapshot['event'];
    bookingId: string;
    subject: string;
    parentName: string;
    parentEmail: string;
    parentTimezone: string;
    mentorName: string;
    mentorEmail: string;
    mentorTimezone: string;
    start: Date;
    classLink: string;
    manageToken?: string;
  }): NotificationSnapshot {
    return {
      event: input.event,
      bookingId: input.bookingId,
      subject: input.subject,
      parentName: input.parentName,
      parentEmail: input.parentEmail,
      parentTime: formatInZone(input.start, input.parentTimezone),
      mentorName: input.mentorName,
      mentorEmail: input.mentorEmail,
      mentorTime: formatInZone(input.start, input.mentorTimezone),
      classroomLink: input.classLink,
      manageLink: input.manageToken
        ? `${config.publicAppUrl.replace(/\/$/, '')}/booking/${encodeURIComponent(input.bookingId)}?token=${encodeURIComponent(input.manageToken)}`
        : undefined,
    };
  }

  private async createNotifications(tx: Prisma.TransactionClient, bookingId: string, notices: Array<{
    recipientType: string;
    recipientEmail: string;
    type: string;
    snapshot: NotificationSnapshot;
  }>) {
    await tx.notification.createMany({
      data: notices.map((notice) => ({
        bookingId,
        recipientType: notice.recipientType,
        recipientEmail: notice.recipientEmail,
        type: notice.type,
        message: JSON.stringify(notice.snapshot),
      })),
    });
  }

  private async deliverNotificationEmails(bookingId: string) {
    if (!isEmailConfigured()) return;
    const notifications = await this.db.notification.findMany({ where: { bookingId, status: 'QUEUED' } });
    for (const notification of notifications) {
      if (notification.recipientType !== 'PARENT' && notification.recipientType !== 'MENTOR') continue;
      let details: NotificationSnapshot;
      try {
        details = JSON.parse(notification.message) as NotificationSnapshot;
      } catch {
        await this.db.notification.update({ where: { id: notification.id }, data: { status: 'FAILED' } });
        continue;
      }
      try {
        await sendBookingEmail({
          ...details,
          recipientType: notification.recipientType,
          recipientEmail: notification.recipientEmail,
        });
        await this.db.notification.update({ where: { id: notification.id }, data: { status: 'SENT' } });
        console.info(JSON.stringify({ event: 'booking_email_sent', bookingId, recipientType: notification.recipientType, type: notification.type }));
      } catch (error) {
        await this.db.notification.update({ where: { id: notification.id }, data: { status: 'FAILED' } });
        console.error(JSON.stringify({ event: 'booking_email_failed', bookingId, recipientType: notification.recipientType, error: error instanceof Error ? error.message : 'Unknown mail error' }));
      }
    }
  }

  private async managedBooking(id: string, managementToken: string) {
    const booking = await this.db.booking.findUnique({ where: { id } });
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
    if (!booking.manageToken || !secureEqual(booking.manageToken, managementToken)) {
      throw new AppError('BOOKING_ACCESS_DENIED', 'This booking management link is invalid or expired.', 403);
    }
    return booking;
  }

  async getManaged(id: string, managementToken: string) {
    await this.managedBooking(id, managementToken);
    return this.get(id);
  }

  async get(id: string, db: PrismaClient | Prisma.TransactionClient = this.db) {
    const booking = await db.booking.findUnique({
      where: { id },
      include: { parent: true, mentor: true, notifications: { orderBy: { createdAt: 'asc' } } },
    });
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
    return {
      id: booking.id,
      status: booking.status,
      subject: booking.subject,
      parent: { name: booking.parent.name, email: booking.parent.email, timezone: booking.parentTimezone },
      mentor: { id: booking.mentor.id, name: booking.mentor.name, timezone: booking.mentorTimezone },
      startUtc: booking.scheduledStartUtc.toISOString(),
      endUtc: booking.scheduledEndUtc.toISOString(),
      parentTime: formatInZone(booking.scheduledStartUtc, booking.parentTimezone),
      mentorTime: formatInZone(booking.scheduledStartUtc, booking.mentorTimezone),
      classLink: booking.classLink,
      meetingProvider: booking.meetingProvider,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      notifications: booking.notifications.map((notification) => ({
        recipientType: notification.recipientType,
        email: notification.recipientEmail,
        status: notification.status,
        type: notification.type,
      })),
    };
  }

  private async getClassroom(token: string) {
    const booking = await this.db.booking.findUnique({ where: { classToken: token }, include: { parent: true, mentor: true } });
    if (!booking) throw new AppError('CLASS_NOT_FOUND', 'This private classroom link is invalid or expired.', 404);
    const now = Date.now();
    const start = booking.scheduledStartUtc.getTime();
    const end = booking.scheduledEndUtc.getTime();
    return {
      id: booking.id,
      status: booking.status,
      subject: booking.subject,
      parentName: booking.parent.name,
      mentor: { name: booking.mentor.name, timezone: booking.mentorTimezone },
      startUtc: booking.scheduledStartUtc.toISOString(),
      endUtc: booking.scheduledEndUtc.toISOString(),
      parentTimezone: booking.parentTimezone,
      mentorTimezone: booking.mentorTimezone,
      parentTime: formatInZone(booking.scheduledStartUtc, booking.parentTimezone),
      mentorTime: formatInZone(booking.scheduledStartUtc, booking.mentorTimezone),
      meetingProvider: booking.meetingProvider,
      classroomUrl: booking.classLink,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      classStarted: now >= start,
      classEnded: now >= end,
      joinAvailable: booking.status === 'CONFIRMED' && now >= start && now < end,
    };
  }

  async classroomByToken(token: string) {
    return this.getClassroom(token);
  }

  async addToCalendar(token: string) {
    const booking = await this.db.booking.findUnique({ where: { classToken: token }, include: { parent: true, mentor: true } });
    if (!booking) throw new AppError('CLASS_NOT_FOUND', 'This private classroom link is invalid or expired.', 404);
    const formatUtc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const summary = escapeText(`CodeYoung trial class · ${booking.subject}`);
    const description = escapeText(`Trial class with ${booking.mentor.name}. Private classroom: ${booking.classLink}`);
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CodeYoung//Trial Class//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', `UID:${booking.id}@codeyoung`, `DTSTAMP:${formatUtc(new Date())}`,
      `DTSTART:${formatUtc(booking.scheduledStartUtc)}`, `DTEND:${formatUtc(booking.scheduledEndUtc)}`,
      `SUMMARY:${summary}`, `DESCRIPTION:${description}`, `URL:${booking.classLink}`,
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
  }

  async verifyClassToken(token: string) {
    return this.getClassroom(token);
  }

  async byToken(token: string) {
    return this.getClassroom(token);
  }
}
