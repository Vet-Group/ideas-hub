// Run-time check of updateIdeaAction's patch: a server action is a public endpoint, so its arguments are untrusted.
import { z } from 'zod';
import { t } from '@/lib/strings.vi';

const MAX_NOTES_CHARS = 5000;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 50;

const bad = t.ideaPatch.invalid;

/** Only the fields the details form sends; the assignee's membership is checked by updateIdea. */
export const ideaPatch = z.strictObject(
  {
    notes: z.string(bad).max(MAX_NOTES_CHARS, t.ideaPatch.notes).nullable().optional(),
    tags: z
      .array(z.string(bad).trim().max(MAX_TAG_CHARS, t.ideaPatch.tags), bad)
      .transform((tags) => [...new Set(tags.filter(Boolean))])
      .pipe(z.array(z.string()).max(MAX_TAGS, t.ideaPatch.tags))
      .optional(),
    assigneeId: z.string(bad).min(1, bad).max(100, bad).nullable().optional(),
  },
  bad,
);
