import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import {
  clearAdminSessionCookie,
  createAdminSession,
  getAdminSession,
  isAdminConfigured,
  setAdminSessionCookie,
} from '../middleware/adminAuth.js';
import { adminLoginSchema } from '../validators/booking.js';

function secureEqual(left: string, right: string) {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function adminSession(req: Request, res: Response) {
  const session = getAdminSession(req);
  res.json({
    success: true,
    data: {
      configured: isAdminConfigured(),
      authenticated: Boolean(session),
      email: session?.email,
    },
  });
}

export function adminLogin(req: Request, res: Response) {
  if (!isAdminConfigured()) {
    throw new AppError('ADMIN_NOT_CONFIGURED', 'Admin login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET.', 503);
  }
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Enter a valid admin email and password.', 422);

  const emailMatches = secureEqual(parsed.data.email.toLowerCase(), config.adminEmail!.toLowerCase());
  const passwordMatches = secureEqual(parsed.data.password, config.adminPassword!);
  if (!(emailMatches && passwordMatches)) {
    throw new AppError('ADMIN_UNAUTHORIZED', 'Email or password is incorrect.', 401);
  }

  setAdminSessionCookie(res, createAdminSession(config.adminEmail!.toLowerCase()));
  res.json({ success: true, data: { authenticated: true, email: config.adminEmail!.toLowerCase() } });
}

export function adminLogout(_req: Request, res: Response) {
  clearAdminSessionCookie(res);
  res.json({ success: true, data: { authenticated: false } });
}
