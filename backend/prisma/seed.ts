import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demoMentors = [
  ['Ananya Sharma', 'Asia/Kolkata'],
  ['Rohan Mehta', 'Asia/Kolkata'],
  ['Priya Nair', 'Asia/Kolkata'],
  ['Arjun Kapoor', 'Asia/Kolkata'],
  ['Meera Iyer', 'Asia/Kolkata'],
  ['Kabir Shah', 'Asia/Kolkata'],
  ['Ava Thompson', 'America/New_York'],
  ['Oliver Reed', 'Europe/London'],
  ['Sofia Martinez', 'America/Los_Angeles'],
  ['Lukas Weber', 'Europe/Berlin'],
] as const;
const demoSubjects = ['Coding', 'Creative AI', 'Robotics', 'Math Puzzles'];

async function main() {
  for (const [index, [name, timezone]] of demoMentors.entries()) {
    const mentor = await prisma.mentor.upsert({
      where: { email: `mentor${index + 1}@example.com` },
      update: { name, timezone },
      create: { name, email: `mentor${index + 1}@example.com`, timezone },
    });
    for (const subject of demoSubjects) {
      await prisma.mentorSubject.upsert({
        where: { mentorId_subject: { mentorId: mentor.id, subject } },
        update: {},
        create: { mentorId: mentor.id, subject },
      });
    }
  }
  console.info(`Seeded ${demoMentors.length} demo mentors and ${demoSubjects.length} demo subjects.`);
}

main().finally(() => prisma.$disconnect());
