import { z } from 'zod';
export const bookingSchema=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),timezone:z.string().min(1),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string().regex(/^\d{2}:\d{2}$/),idempotencyKey:z.string().min(8).max(100).optional()});
export const slotsSchema=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),timezone:z.string().min(1)});
