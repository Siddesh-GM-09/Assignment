import 'dotenv/config';
export const config={
  port:Number(process.env.PORT??3001),
  frontendUrl:process.env.FRONTEND_URL??'http://localhost:5173',
  slotDurationMinutes:Number(process.env.SLOT_DURATION_MINUTES??60),
  bookingWindowDays:Number(process.env.BOOKING_WINDOW_DAYS??14),
  businessStartHour:Number(process.env.BUSINESS_START_HOUR??9),
  businessEndHour:Number(process.env.BUSINESS_END_HOUR??21),
  smtpHost:process.env.SMTP_HOST,
  smtpPort:Number(process.env.SMTP_PORT??587),
  smtpSecure:process.env.SMTP_SECURE==='true',
  smtpUser:process.env.SMTP_USER,
  smtpPassword:process.env.SMTP_PASSWORD,
  mailFrom:process.env.MAIL_FROM,
  publicAppUrl:process.env.PUBLIC_APP_URL??'http://localhost:5173',
  adminEmail:process.env.ADMIN_EMAIL,
  adminPassword:process.env.ADMIN_PASSWORD,
  adminSessionSecret:process.env.ADMIN_SESSION_SECRET,
};
