import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { recordings } from '../../../db/schema.js'
import { ConfigurationError, NotFoundError } from '../../../http/errors.js'

export function createRecordingService(db: Database, config: Pick<AppConfig, 'r2Endpoint' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>) {
  async function getPlayback(organizationId: string, attemptId: string) {
    const [recording] = await db.select().from(recordings).where(and(eq(recordings.organizationId, organizationId), eq(recordings.attemptId, attemptId))).limit(1)
    if (!recording || recording.status !== 'COMPLETED') throw new NotFoundError('Completed recording')
    if (!config.r2Endpoint || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2BucketName) throw new ConfigurationError('Cloudflare R2')
    const client = new S3Client({ region: 'auto', endpoint: config.r2Endpoint, credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } })
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.r2BucketName, Key: recording.storageKey }), { expiresIn: 300 })
    return { url, expiresInSeconds: 300, recording: { id: recording.id, mimeType: recording.mimeType, byteSize: recording.byteSize, durationSeconds: recording.durationSeconds } }
  }
  return { getPlayback }
}
export type RecordingService = ReturnType<typeof createRecordingService>
