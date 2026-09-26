import { DateTime, IANAZone } from 'luxon';
import { AppError } from '../errors/AppError.js';
export function assertTimezone(zone:string){if(!IANAZone.isValidZone(zone))throw new AppError('INVALID_TIMEZONE','Choose a valid timezone.',422)}
export function localToUtc(date:string,time:string,zone:string){assertTimezone(zone);const dt=DateTime.fromISO(`${date}T${time}`,{zone});if(!dt.isValid||dt.toFormat('yyyy-MM-dd')!==date||dt.toFormat('HH:mm')!==time)throw new AppError('INVALID_LOCAL_TIME','That local time does not exist. Please choose another time.',422);return dt.toUTC().toJSDate()}
export function localDayRange(instant:Date,zone:string){const day=DateTime.fromJSDate(instant,{zone}).startOf('day');return {start:day.toUTC().toJSDate(),end:day.plus({days:1}).toUTC().toJSDate()}}
export function formatInZone(instant:Date,zone:string){return DateTime.fromJSDate(instant,{zone}).toFormat("cccc, LLLL d · h:mm a ZZZZ")}
