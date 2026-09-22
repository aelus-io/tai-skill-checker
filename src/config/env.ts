import { resolve } from 'node:path'
import { z } from 'zod'

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value === '' ? undefined : value, schema.optional())

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),
  GOOGLE_GENERATIVE_AI_API_KEY: optional(z.string().min(1)),
  GEMINI_MODEL: z.string().min(1).refine(
    (model) => !model.toLowerCase().includes('live'),
    'GEMINI_MODEL must support generateContent; configure realtime models through GEMINI_LIVE_MODEL',
  ).default('gemini-3-flash-preview'),
  GEMINI_LIVE_MODEL: z.string().min(1).default('gemini-2.5-flash-native-audio-preview-12-2025'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  RESEND_API_KEY: optional(z.string().min(1)),
  RESEND_FROM_EMAIL: optional(z.email()),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_ASSESSMENT_ATTEMPTS: z.coerce.number().int().positive().default(3),
  LIVEKIT_URL: optional(z.url()),
  LIVEKIT_API_KEY: optional(z.string().min(1)),
  LIVEKIT_API_SECRET: optional(z.string().min(1)),
  LIVEKIT_AGENT_NAME: z.string().min(1).default('assessment-interviewer'),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  R2_ENDPOINT: optional(z.url()),
  R2_ACCESS_KEY_ID: optional(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  R2_BUCKET_NAME: optional(z.string().min(1)),
}).superRefine((env, context) => {
  if (env.RESEND_API_KEY && !env.RESEND_FROM_EMAIL) {
    context.addIssue({ code: 'custom', path: ['RESEND_FROM_EMAIL'], message: 'Required when RESEND_API_KEY is configured' })
  }
  const livekit = [env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET]
  if (livekit.some(Boolean) && !livekit.every(Boolean)) context.addIssue({ code: 'custom', path: ['LIVEKIT_URL'], message: 'LiveKit URL, key, and secret must be configured together' })
  const r2 = [env.R2_ENDPOINT, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET_NAME]
  if (r2.some(Boolean) && !r2.every(Boolean)) context.addIssue({ code: 'custom', path: ['R2_ENDPOINT'], message: 'All R2 settings must be configured together' })
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
  geminiLiveModel: string
  geminiEmbeddingModel: string
  resendApiKey?: string
  resendFromEmail?: string
  invitationTtlHours: number
  uploadDir: string
  maxPdfBytes: number
  maxAssessmentAttempts: number
  livekitUrl?: string
  livekitApiKey?: string
  livekitApiSecret?: string
  livekitAgentName: string
  livekitTokenTtlSeconds: number
  r2Endpoint?: string
  r2AccessKeyId?: string
  r2SecretAccessKey?: string
  r2BucketName?: string
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
    geminiLiveModel: env.GEMINI_LIVE_MODEL,
    geminiEmbeddingModel: env.GEMINI_EMBEDDING_MODEL,
    ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
    ...(env.RESEND_FROM_EMAIL ? { resendFromEmail: env.RESEND_FROM_EMAIL } : {}),
    invitationTtlHours: env.INVITATION_TTL_HOURS,
    uploadDir: resolve(env.UPLOAD_DIR),
    maxPdfBytes: env.MAX_PDF_BYTES,
    maxAssessmentAttempts: env.MAX_ASSESSMENT_ATTEMPTS,
    ...(env.LIVEKIT_URL ? { livekitUrl: env.LIVEKIT_URL } : {}),
    ...(env.LIVEKIT_API_KEY ? { livekitApiKey: env.LIVEKIT_API_KEY } : {}),
    ...(env.LIVEKIT_API_SECRET ? { livekitApiSecret: env.LIVEKIT_API_SECRET } : {}),
    livekitAgentName: env.LIVEKIT_AGENT_NAME,
    livekitTokenTtlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
    ...(env.R2_ENDPOINT ? { r2Endpoint: env.R2_ENDPOINT } : {}),
    ...(env.R2_ACCESS_KEY_ID ? { r2AccessKeyId: env.R2_ACCESS_KEY_ID } : {}),
    ...(env.R2_SECRET_ACCESS_KEY ? { r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY } : {}),
    ...(env.R2_BUCKET_NAME ? { r2BucketName: env.R2_BUCKET_NAME } : {}),
  }
}
