import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the schema against ./drizzle; it needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
});
