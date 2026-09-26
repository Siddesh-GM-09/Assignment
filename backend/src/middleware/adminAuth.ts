import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

const cookieName = 'admin_session';
const sessionMaxAgeSeconds = 8 * 60 * 60;

export function isAdminConfigured() {
  return Boolean(
    config.adminEmail
    && config.adminPassword
    && config.adminPassword.length >= 12
    && config.adminSessionSecret
    && config.adminSessionSecret.length >= 32,
  );
}

function signature(value: string) {
  return createHmac('sha256', config.adminSessionSecret!).update(value).digest();
}

export function createAdminSession(email: string) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds,
  })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) return valueParts.join('=');
  }
  return undefined;
}

export function getAdminSession(req: Request) {
  if (!isAdminConfigured()) return null;
  const token = readCookie(req, cookieName);
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(token.slice(separator + 1), 'base64url');
  } catch {
    return null;
  }
  const expectedSignature = signature(payload);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown; exp?: unknown };
    if (typeof session.email !== 'string'
      || session.email.toLowerCase() !== config.adminEmail!.toLowerCase()
      || typeof session.exp !== 'number'
      || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return { email: config.adminEmail!.toLowerCase() };
  } catch {
    return null;
  }
}

export function setAdminSessionCookie(res: Response, value: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionMaxAgeSeconds}${secure}`);
}

export function clearAdminSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`);
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isAdminConfigured()) {
    next(new AppError('ADMIN_NOT_CONFIGURED', 'Admin login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET.', 503));
    return;
  }
  if (!getAdminSession(req)) {
    next(new AppError('ADMIN_UNAUTHORIZED', 'Please log in to access the admin dashboard.', 401));
    return;
  }
  next();
}
