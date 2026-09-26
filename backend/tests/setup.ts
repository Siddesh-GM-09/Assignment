import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const demoDatabase = resolve(process.cwd(), 'prisma/dev.db');
const testDatabase = resolve(process.cwd(), 'prisma/test.db');

export default function setup() {
  if (!existsSync(demoDatabase)) {
    throw new Error('Run the local database setup commands before npm test.');
  }

  copyFileSync(demoDatabase, testDatabase);
}
