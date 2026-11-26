import { z } from 'zod';

export const createPlanSchema = z
  .object({
    minSeconds: z.number().int().min(5).max(180).optional(),
    maxSeconds: z.number().int().min(5).max(180).optional(),
    maxClips: z.number().int().min(1).max(20).optional(),
  })
  .refine((s) => s.minSeconds === undefined || s.maxSeconds === undefined || s.minSeconds <= s.maxSeconds, {
    message: 'minSeconds must not be greater than maxSeconds',
  });

export type CreatePlan = z.infer<typeof createPlanSchema>;

export const adjustClipSchema = z
  .object({
    startSeconds: z.number().min(0).optional(),
    endSeconds: z.number().positive().optional(),
  })
  .refine((c) => c.startSeconds !== undefined || c.endSeconds !== undefined, {
    message: 'Give startSeconds, endSeconds or both',
  });

export type AdjustClip = z.infer<typeof adjustClipSchema>;

export const DEFAULT_MIN_SECONDS = 15;
export const DEFAULT_MAX_SECONDS = 60;

/** About one clip per 3 minutes of video, 1–10 (spec assumption 3). */
export const defaultMaxClips = (durationSeconds: number) => Math.min(10, Math.max(1, Math.round(durationSeconds / 180)));
