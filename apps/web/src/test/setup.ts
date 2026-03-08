// Env stubs — tests never hit real services
process.env.ADMIN_SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.ADMIN_PASSWORD = 'test-admin-pw';
process.env.CRON_SECRET = 'test-cron-secret';
// NODE_ENV is read-only in @types/node, but we need it for test setup
(process.env as Record<string, string>).NODE_ENV = 'test';
// No DATABASE_URL, REDIS_URL, or LLM keys — forces mocks to be required
