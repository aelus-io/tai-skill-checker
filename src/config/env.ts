import { resolve } from 'node:path'
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.email().optional(),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
}).superRefine((env, context) => {
  if (env.RESEND_API_KEY && !env.RESEND_FROM_EMAIL) {
    context.addIssue({ code: 'custom', path: ['RESEND_FROM_EMAIL'], message: 'Required when RESEND_API_KEY is configured' })
  }
})

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  databaseUrl: string
  authSecret: string
  authUrl: string
  frontendUrl: string
  geminiApiKey?: string
  geminiModel: string
  resendApiKey?: string
  resendFromEmail?: string
  invitationTtlHours: number
  uploadDir: string
  maxPdfBytes: number
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = EnvSchema.parse(source)
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    authUrl: env.BETTER_AUTH_URL,
    frontendUrl: env.FRONTEND_URL,
    ...(env.GOOGLE_GENERATIVE_AI_API_KEY ? { geminiApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY } : {}),
    geminiModel: env.GEMINI_MODEL,
    ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
    ...(env.RESEND_FROM_EMAIL ? { resendFromEmail: env.RESEND_FROM_EMAIL } : {}),
    invitationTtlHours: env.INVITATION_TTL_HOURS,
    uploadDir: resolve(env.UPLOAD_DIR),
    maxPdfBytes: env.MAX_PDF_BYTES,
  }
}
