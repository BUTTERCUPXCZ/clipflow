import { createParamDecorator } from '@nestjs/common';

/** Seeded by drizzle/0001_seed_local_user.sql. */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The auth seam: every handler gets the acting user's id from here and passes it down to the repositories.
 * shortcut: always the single local user (spec Phase 2, no login); replace this body with a session or
 * token lookup if accounts are ever added — nothing else changes.
 */
export const CurrentUser = createParamDecorator((): string => LOCAL_USER_ID);
