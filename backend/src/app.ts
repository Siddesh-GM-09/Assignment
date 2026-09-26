import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { adminLogin, adminLogout, adminSession } from './controllers/adminAuth.js';
import { cancelAdminBooking, cancelBooking, createBooking, getBooking, getClass, getClassCalendar, health, admin, recommendations, rescheduleBooking, setMentorActive, slots, timezones } from './controllers/api.js';
import { asyncRoute, errorHandler } from './middleware/errors.js';
import { requireAdmin } from './middleware/adminAuth.js';

export const app = express();
app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Please try again later.' } },
});

app.get('/api/health', asyncRoute(health));
app.get('/api/timezones', timezones);
app.get('/api/slots', asyncRoute(slots));
app.get('/api/recommendations', asyncRoute(recommendations));
app.post('/api/bookings', asyncRoute(createBooking));
app.get('/api/bookings/:id', asyncRoute(getBooking));
app.get('/api/bookings/:id/class', asyncRoute(getBooking));
app.post('/api/bookings/:id/reschedule', asyncRoute(rescheduleBooking));
app.post('/api/bookings/:id/cancel', asyncRoute(cancelBooking));
app.get('/api/class/:token/calendar.ics', asyncRoute(getClassCalendar));
app.get('/api/class/:token', asyncRoute(getClass));
app.get('/api/admin/session', adminSession);
app.post('/api/admin/login', adminLoginLimiter, adminLogin);
app.post('/api/admin/logout', adminLogout);
app.get('/api/admin', requireAdmin, asyncRoute(admin));
app.patch('/api/admin/mentors/:id', requireAdmin, asyncRoute(setMentorActive));
app.post('/api/admin/bookings/:id/cancel', requireAdmin, asyncRoute(cancelAdminBooking));
app.use(errorHandler);
