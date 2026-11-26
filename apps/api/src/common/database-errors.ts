/** Postgres unique_violation (23505); drizzle wraps the pg error in `cause`. */
export const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';
