import { z } from "zod"

/**
 * Pre-submit mirror of the backend `vocabularyItemSchema`
 * (backend/src/vocabulary/vocabulary.service.ts). Validating here gives the
 * user immediate, per-field feedback; the backend remains the authority.
 */
export const customVocabSchema = z.object({
  word: z
    .string()
    .trim()
    .min(2, "Word or phrase must be at least 2 characters")
    .max(80, "Word is too long (max 80 characters)"),
  phonetic: z.string().trim().max(120).optional().nullable(),
  partOfSpeech: z.enum([
    "verb",
    "noun",
    "adjective",
    "adverb",
    "collocation",
    "idiom",
  ]),
  definition: z
    .string()
    .trim()
    .min(10, "Definition must be at least 10 characters long")
    .max(1000, "Definition is too long (max 1000 characters)"),
  bandTarget: z
    .number()
    .refine((v) => v >= 6 && v <= 9 && (v * 2) % 1 === 0, {
      message: "Band target must be between 6.0 and 9.0 in 0.5 steps",
    }),
  topic: z.string().trim().min(1, "Choose a topic").max(60),
  collocations: z.array(z.string().trim().min(1).max(120)).max(20, "Too many collocations (max 20)"),
  synonyms: z.array(z.string().trim().min(1).max(80)).max(20, "Too many synonyms (max 20)"),
  exampleSentence: z
    .string()
    .trim()
    .min(15, "Example sentence must be at least 15 characters long")
    .max(1000, "Example sentence is too long (max 1000 characters)"),
})

export type CustomVocabFormData = z.infer<typeof customVocabSchema>
