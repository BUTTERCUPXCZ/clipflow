import { z } from 'zod';

/** Route `:id` params. Rejects malformed ids with 400 before they reach SQL. */
export const uuidParam = z.uuid({ error: 'must be a valid UUID' });
