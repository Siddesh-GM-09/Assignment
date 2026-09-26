import 'dotenv/config';
export const config={port:Number(process.env.PORT??3001),frontendUrl:process.env.FRONTEND_URL??'http://localhost:5173',slotDurationMinutes:Number(process.env.SLOT_DURATION_MINUTES??60),bookingWindowDays:Number(process.env.BOOKING_WINDOW_DAYS??14),businessStartHour:Number(process.env.BUSINESS_START_HOUR??9),businessEndHour:Number(process.env.BUSINESS_END_HOUR??21)};
