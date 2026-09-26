import { Request, Response } from 'express';
import { DateTime } from 'luxon';
import { prisma } from '../config/database.js';
import { BookingService } from '../services/bookingService.js';
import { bookingSchema,slotsSchema } from '../validators/booking.js';
import { AppError } from '../errors/AppError.js';
export const bookingService=new BookingService(prisma);
export async function slots(req:Request,res:Response){const p=slotsSchema.safeParse(req.query);if(!p.success)throw new AppError('VALIDATION_ERROR','Date and valid timezone are required.',422);res.json({success:true,data:await bookingService.slots(p.data.date,p.data.timezone)})}
export async function createBooking(req:Request,res:Response){const p=bookingSchema.safeParse(req.body);if(!p.success)throw new AppError('VALIDATION_ERROR',p.error.issues[0]?.message??'Invalid request.',422);res.status(201).json({success:true,data:await bookingService.create(p.data)})}
export async function getBooking(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('VALIDATION_ERROR', 'A booking ID is required.', 400);
  res.json({ success: true, data: await bookingService.get(id) });
}
export async function getClass(req: Request, res: Response) {
  const token = req.params.token;
  if (typeof token !== 'string') throw new AppError('VALIDATION_ERROR', 'A class token is required.', 400);
  res.json({ success: true, data: await bookingService.byToken(token) });
}
export async function timezones(_req:Request,res:Response){res.json({success:true,data:[...Intl.supportedValuesOf('timeZone')].map(id=>({id,label:id.replaceAll('_',' ')}))})}
export async function admin(_req:Request,res:Response){const mentors=await prisma.mentor.findMany({include:{bookings:{where:{status:'CONFIRMED'},include:{parent:true},orderBy:{scheduledStartUtc:'asc'}}},orderBy:{name:'asc'}});const today=DateTime.now().toUTC().startOf('day').toJSDate();const bookings=await prisma.booking.findMany({include:{parent:true,mentor:true},orderBy:{scheduledStartUtc:'desc'},take:100});res.json({success:true,data:{mentors:mentors.map(m=>({id:m.id,name:m.name,email:m.email,timezone:m.timezone,bookings:m.bookings.map(b=>({id:b.id,startUtc:b.scheduledStartUtc.toISOString(),parentTimezone:b.parentTimezone,parentName:b.parent.name}))})),todayCount:bookings.filter(b=>b.scheduledStartUtc>=today).length,bookings:bookings.map(b=>({id:b.id,status:b.status,parentName:b.parent.name,mentorName:b.mentor.name,startUtc:b.scheduledStartUtc.toISOString(),parentTimezone:b.parentTimezone,mentorTimezone:b.mentorTimezone}))}})}
