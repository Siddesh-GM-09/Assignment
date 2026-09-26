import { defineConfig } from 'vitest/config';

// Keep integration tests away from the developer's seeded demo database.
process.env.DATABASE_URL = 'file:./test.db';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/setup.ts'],
  },
});
