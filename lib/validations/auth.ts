import { z } from "zod"

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email address is required")
    .email("Please enter a valid email address (e.g. candidate@example.com)"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters"),
})

export type LoginFormData = z.infer<typeof loginSchema>

export const registerSchema = z.object({
  name: z
    .string()
    .min(2, "Full name must be at least 2 characters")
    .max(80, "Name is too long"),
  email: z
    .string()
    .min(1, "Email address is required")
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(128, "Password is too long"),
  targetBand: z
    .number({ message: "Target band is required" })
    .min(5.0, "Minimum IELTS target band is 5.0")
    .max(9.0, "Maximum IELTS band is 9.0")
    .refine((val) => (val * 2) % 1 === 0, {
      message: "Target band must be in 0.5 increments (e.g. 6.5, 7.0, 7.5, 8.0)",
    }),
})

export type RegisterFormData = z.infer<typeof registerSchema>
