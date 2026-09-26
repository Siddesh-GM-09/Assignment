import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

export type BookingEmail = {
  recipientType: 'PARENT' | 'MENTOR';
  recipientEmail: string;
  parentName: string;
  parentEmail: string;
  parentTime: string;
  mentorName: string;
  mentorEmail: string;
  mentorTime: string;
  subject: string;
  bookingId: string;
  classroomLink: string;
  manageLink?: string;
  event: 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED';
};

export function isEmailConfigured() {
  return process.env.NODE_ENV !== 'test' && Boolean(config.smtpHost && config.mailFrom);
}

export async function sendBookingEmail(booking: BookingEmail) {
  if (!isEmailConfigured()) return false;

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure || config.smtpPort === 465,
    auth: config.smtpUser && config.smtpPassword
      ? { user: config.smtpUser, pass: config.smtpPassword }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const isParent = booking.recipientType === 'PARENT';
  const greetingName = isParent ? booking.parentName : booking.mentorName;
  const localTime = isParent ? booking.parentTime : booking.mentorTime;
  const counterpart = isParent ? booking.mentorName : booking.parentName;
  const counterpartRole = isParent ? 'YOUR MENTOR' : 'PARENT';
  const counterpartTime = isParent ? booking.mentorTime : booking.parentTime;
  const counterpartTimeLabel = isParent ? 'MENTOR LOCAL TIME' : 'PARENT LOCAL TIME';
  const copy = emailCopy(booking.event, isParent);

  const text = [
    `Hi ${greetingName},`,
    '',
    copy.intro,
    `Course: ${booking.subject}`,
    `Your local time: ${localTime}`,
    `${counterpartRole}: ${counterpart}`,
    `${counterpartTimeLabel}: ${counterpartTime}`,
    `Booking reference: ${booking.bookingId}`,
    `Private CodeYoung classroom: ${booking.classroomLink}`,
    ...(isParent && booking.manageLink ? [`Manage this booking: ${booking.manageLink}`] : []),
    '',
    isParent ? 'We look forward to seeing you!' : `Parent contact: ${booking.parentEmail}`,
  ].join('\n');

  await transporter.sendMail({
    from: config.mailFrom,
    to: booking.recipientEmail,
    subject: copy.subject,
    text,
    html: renderHtml({ booking, greetingName, localTime, counterpart, counterpartRole, counterpartTime, counterpartTimeLabel, copy, isParent }),
  });
  return true;
}

function emailCopy(event: BookingEmail['event'], isParent: boolean) {
  if (event === 'CANCELLED') {
    return {
      subject: isParent ? 'Your CodeYoung trial class was cancelled' : 'A CodeYoung trial class was cancelled',
      title: 'Class cancelled',
      intro: 'This trial class has been cancelled.',
      note: isParent ? 'You can book another complimentary class whenever you are ready.' : 'This time is now available for another class.',
      cta: 'View booking details',
    };
  }
  if (event === 'RESCHEDULED') {
    return {
      subject: isParent ? 'Your CodeYoung trial class has a new time' : 'A CodeYoung trial class has been rescheduled',
      title: 'Class time updated',
      intro: 'The trial class time has been updated.',
      note: 'Use the updated local times below. Your private classroom link remains the same.',
      cta: 'Open private classroom',
    };
  }
  return {
    subject: isParent ? 'Your CodeYoung trial class is confirmed' : 'New CodeYoung trial class assigned',
    title: isParent ? 'You’re all set!' : 'A new class is booked',
    intro: isParent ? 'Your complimentary class is confirmed.' : 'A complimentary trial class has been assigned to you.',
    note: 'Your private classroom opens at the scheduled time. This development room is a waiting room and does not provide live audio or video.',
    cta: 'Open private classroom',
  };
}

function renderHtml(details: {
  booking: BookingEmail;
  greetingName: string;
  localTime: string;
  counterpart: string;
  counterpartRole: string;
  counterpartTime: string;
  counterpartTimeLabel: string;
  copy: ReturnType<typeof emailCopy>;
  isParent: boolean;
}) {
  const { booking, greetingName, localTime, counterpart, counterpartRole, counterpartTime, counterpartTimeLabel, copy, isParent } = details;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f5ef;font-family:Arial,Helvetica,sans-serif;color:#243021">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5ef;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e7ebdf;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 32px 22px;background:#263b21;color:#fff">
          <div style="font-size:12px;font-weight:bold;letter-spacing:2px;color:#c8e789">CODEYOUNG · TRIAL CLASS</div>
          <h1 style="font-size:26px;line-height:1.25;margin:14px 0 6px;color:#fff">${copy.title}</h1>
          <p style="margin:0;color:#e2ead7;font-size:15px">${copy.intro}</p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 20px;font-size:16px">Hi ${escapeHtml(greetingName)},</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8f4;border-radius:12px">
            <tr><td style="padding:18px 20px">
              <div style="font-size:11px;letter-spacing:1px;color:#71805f;font-weight:bold">YOUR LOCAL CLASS TIME</div>
              <div style="font-size:17px;font-weight:bold;margin-top:7px;color:#263b21">${escapeHtml(localTime)}</div>
              <div style="height:14px"></div>
              <div style="font-size:11px;letter-spacing:1px;color:#71805f;font-weight:bold">${counterpartRole}</div>
              <div style="font-size:15px;font-weight:bold;margin-top:7px;color:#263b21">${escapeHtml(counterpart)}</div>
              <div style="font-size:13px;color:#687163;margin-top:4px">${counterpartTimeLabel}: ${escapeHtml(counterpartTime)}</div>
              <div style="font-size:13px;color:#687163;margin-top:8px">Course: ${escapeHtml(booking.subject)}</div>
              <div style="font-size:12px;color:#687163;margin-top:8px">Booking reference: ${escapeHtml(booking.bookingId)}</div>
            </td></tr>
          </table>
          <p style="font-size:13px;line-height:1.6;color:#687163;margin:20px 0">${copy.note}</p>
          ${booking.event !== 'CANCELLED' ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 12px"><tr><td bgcolor="#86a94b" style="border-radius:8px"><a href="${escapeHtml(booking.classroomLink)}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:bold">${copy.cta}&nbsp; →</a></td></tr></table>` : ''}
          ${isParent && booking.manageLink ? `<p style="margin:18px 0 0;font-size:13px"><a href="${escapeHtml(booking.manageLink)}" style="color:#557a2d;font-weight:bold">Change or cancel this booking</a></p>` : ''}
          <p style="font-size:13px;color:#687163;line-height:1.6;margin:22px 0 0">${isParent ? 'We look forward to seeing you!' : `Parent contact: ${escapeHtml(booking.parentEmail)}`}</p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafbf8;border-top:1px solid #edf0e9;color:#899184;font-size:11px">CodeYoung · A little curiosity goes a long way.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}
