import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { assessments, assignments } from '../../../db/schema.js'
import { AppError, ConfigurationError, NotFoundError } from '../../../http/errors.js'

const imageTypes = [
  { mimeType: 'image/png', extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: 'image/jpeg', extension: 'jpg', matches: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mimeType: 'image/webp', extension: 'webp', matches: (bytes: Buffer) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
] as const

// The file type is taken from the image signature, never the client-declared MIME type, so SVG or HTML cannot be served back.
export function detectCoverImageType(bytes: Buffer) {
  return imageTypes.find((type) => type.matches(bytes)) ?? null
}

// The storage key's random segment doubles as a cache-busting version, so clients can cache the image indefinitely.
export function coverImageUrl(path: string, coverImageKey: string | null) {
  if (!coverImageKey) return null
  const version = coverImageKey.split('/').pop()?.split('.')[0] ?? ''
  return `${path}?v=${version}`
}

export function withCoverImageUrl<T extends { id: string; coverImageKey: string | null }>(assessment: T) {
  const { coverImageKey, ...rest } = assessment
  return { ...rest, coverImageUrl: coverImageUrl(`/api/assessments/${assessment.id}/cover`, coverImageKey) }
}

export function createCoverImageService(db: Database, config: Pick<AppConfig, 'maxCoverImageBytes' | 'r2Endpoint' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>) {
  const storage = config.r2Endpoint && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2BucketName
    ? { bucket: config.r2BucketName, client: new S3Client({ region: 'auto', endpoint: config.r2Endpoint, credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } }) }
    : null
  const requireStorage = () => {
    if (!storage) throw new ConfigurationError('Cloudflare R2')
    return storage
  }
  const deleteObject = (storageKey: string) => requireStorage().client.send(new DeleteObjectCommand({ Bucket: requireStorage().bucket, Key: storageKey }))

  async function load(storageKey: string | null) {
    if (!storageKey) throw new NotFoundError('Cover image')
    const { client, bucket } = requireStorage()
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey })).catch((error: unknown) => {
      if (error instanceof NoSuchKey) throw new NotFoundError('Cover image')
      throw error
    })
    const bytes = Buffer.from(await object.Body?.transformToByteArray() ?? [])
    const type = detectCoverImageType(bytes)
    if (!type) throw new NotFoundError('Cover image')
    return { bytes, mimeType: type.mimeType }
  }

  async function setCover(input: { organizationId: string; assessmentId: string; bytes: Buffer }) {
    if (input.bytes.length > config.maxCoverImageBytes) throw new AppError('INVALID_UPLOAD', 'Cover image exceeds the configured size limit', 400)
    const type = detectCoverImageType(input.bytes)
    if (!type) throw new AppError('INVALID_UPLOAD', 'Cover images must be PNG, JPEG, or WebP files', 400)
    const { client, bucket } = requireStorage()
    const [existing] = await db.select({ coverImageKey: assessments.coverImageKey }).from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    if (!existing) throw new NotFoundError('Assessment')

    const storageKey = `covers/${input.organizationId}/${input.assessmentId}/${randomUUID()}.${type.extension}`
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: input.bytes, ContentType: type.mimeType }))
    let updated: typeof assessments.$inferSelect | undefined
    try {
      [updated] = await db.update(assessments).set({ coverImageKey: storageKey, updatedAt: new Date() }).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).returning()
    } catch (error) {
      await deleteObject(storageKey).catch(() => undefined)
      throw error
    }
    if (!updated) {
      await deleteObject(storageKey).catch(() => undefined)
      throw new NotFoundError('Assessment')
    }
    if (existing.coverImageKey) await deleteObject(existing.coverImageKey).catch(() => undefined)
    return withCoverImageUrl(updated)
  }

  async function removeCover(input: { organizationId: string; assessmentId: string }) {
    const [existing] = await db.select({ coverImageKey: assessments.coverImageKey }).from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    if (!existing) throw new NotFoundError('Assessment')
    const [updated] = await db.update(assessments).set({ coverImageKey: null, updatedAt: new Date() }).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).returning()
    if (!updated) throw new NotFoundError('Assessment')
    if (existing.coverImageKey) await deleteObject(existing.coverImageKey).catch(() => undefined)
    return withCoverImageUrl(updated)
  }

  async function readForAdmin(input: { organizationId: string; assessmentId: string }) {
    const [row] = await db.select({ coverImageKey: assessments.coverImageKey }).from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    return load(row?.coverImageKey ?? null)
  }

  async function readForEmployee(input: { organizationId: string; userId: string; assignmentId: string }) {
    const [row] = await db.select({ coverImageKey: assessments.coverImageKey }).from(assignments).innerJoin(assessments, eq(assignments.assessmentId, assessments.id)).where(and(
      eq(assignments.id, input.assignmentId), eq(assignments.organizationId, input.organizationId), eq(assignments.employeeUserId, input.userId),
    )).limit(1)
    return load(row?.coverImageKey ?? null)
  }

  return { setCover, removeCover, readForAdmin, readForEmployee }
}

export type CoverImageService = ReturnType<typeof createCoverImageService>
