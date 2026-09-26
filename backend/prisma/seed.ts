import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const names = ['Ananya Sharma','Rohan Mehta','Priya Nair','Arjun Kapoor','Meera Iyer','Kabir Shah','Ava Thompson','Oliver Reed','Sofia Martinez','Lukas Weber'];
const zones = ['Asia/Kolkata','Asia/Kolkata','Asia/Kolkata','Asia/Kolkata','Asia/Kolkata','Asia/Kolkata','America/New_York','Europe/London','America/Los_Angeles','Europe/Berlin'];
async function main(){for(let i=0;i<names.length;i++) await prisma.mentor.upsert({where:{email:`mentor${i+1}@example.com`},update:{name:names[i],timezone:zones[i],active:true},create:{name:names[i],email:`mentor${i+1}@example.com`,timezone:zones[i]}}); console.info(`Seeded ${names.length} mentors.`)}
main().finally(()=>prisma.$disconnect());
