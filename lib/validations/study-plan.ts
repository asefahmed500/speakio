import { z } from "zod"

export const studyPlanSchema = z.object({
  targetBand: z
    .number({ message: "Target band is required" })
    .min(5.5, "Minimum target band is 5.5")
    .max(9.0, "Maximum target band is 9.0")
    .refine((val) => (val * 2) % 1 === 0, {
      message: "Target band must be in 0.5 increments (e.g. 7.0, 7.5, 8.0)",
    }),
  currentBand: z
    .number({ message: "Current band is required" })
    .min(4.0, "Minimum band is 4.0")
    .max(8.5, "Current band must be lower than 9.0"),
  examDate: z
    .string()
    .min(1, "Target exam date is required"),
  dailyCommitmentMinutes: z
    .number()
    .min(15, "Minimum daily commitment is 15 minutes")
    .max(240, "Maximum daily commitment is 240 minutes (4 hours)"),
  moduleType: z.enum(["ACADEMIC", "GENERAL"]),
  weakestSkill: z.enum(["LISTENING", "READING", "WRITING", "SPEAKING"]),
})

export type StudyPlanFormData = z.infer<typeof studyPlanSchema>
