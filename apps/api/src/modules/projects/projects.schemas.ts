import { z } from 'zod';

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');

// Blank descriptions are stored as NULL, not as empty strings.
const description = z
  .string()
  .trim()
  .max(1000, 'Description must be at most 1000 characters')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const createProjectSchema = z.object({ name, description });

export const updateProjectSchema = z
  .object({ name: name.optional(), description })
  .refine((body) => body.name !== undefined || body.description !== undefined, 'Nothing to update');

export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
