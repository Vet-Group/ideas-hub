import { z } from 'zod';

/** A keyword's text as typed by an admin (seed keyword) or store staff (tracked keyword): 1–100 characters, inner whitespace collapsed. */
export const keywordText = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((v) => v.replace(/\s+/g, ' '));
