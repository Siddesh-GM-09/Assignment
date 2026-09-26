import { z } from 'zod';
import { supportedSubjects } from '../config/subjects.js';
const subjectSchema = z.enum(supportedSubjects);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
export const bookingSchema=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),timezone:z.string().min(1).max(80),date:dateSchema,time:timeSchema,subject:subjectSchema.default('Coding'),idempotencyKey:z.string().min(8).max(100).optional()});
export const slotsSchema=z.object({date:dateSchema,timezone:z.string().min(1).max(80),subject:subjectSchema.default('Coding')});
export const recommendationsSchema=slotsSchema;
export const managedBookingSchema=z.object({managementToken:z.string().min(32).max(128)});
export const rescheduleSchema=managedBookingSchema.extend({date:dateSchema,time:timeSchema,timezone:z.string().min(1).max(80),subject:subjectSchema.optional()});
export const adminSchema=z.object({
  days:z.coerce.number().int().refine((value)=>[7,14,30].includes(value)).default(7),
  capacityDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const adminLoginSchema=z.object({email:z.string().trim().email().max(254),password:z.string().min(1).max(200)});
export const adminMentorSchema=z.object({active:z.boolean()});
