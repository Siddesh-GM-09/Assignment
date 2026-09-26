import { defineConfig } from 'vitest/config';

// Keep integration tests away from the developer's seeded demo database.
process.env.DATABASE_URL = 'file:./test.db';
process.env.ADMIN_EMAIL = 'admin-test@example.com';
process.env.ADMIN_PASSWORD = 'Test-only-admin-password-123!';
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-at-least-32-characters';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/setup.ts'],
  },
});
