import { z } from 'zod';

export const importVideoSchema = z.object({
  path: z
    .string({ error: 'path is required' })
    .min(1, 'path is required')
    .max(4096, 'path is too long'),
});

export type ImportVideo = z.infer<typeof importVideoSchema>;
