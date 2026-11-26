import { z } from 'zod';

export const createExperimentSchema = z.object({
  videoId: z.uuid({ error: 'videoId must be a valid UUID' }),
  // Ollama model names: letters, digits and . _ : / - (e.g. "qwen3-vl:8b-instruct").
  model: z.string().regex(/^[\w.:/-]{1,200}$/, 'model must be an Ollama model name'),
  maxFrames: z.number().int().min(1).max(600).optional(),
  batchSize: z.number().int().min(1).max(8).optional(),
});

export type CreateExperiment = z.infer<typeof createExperimentSchema>;
