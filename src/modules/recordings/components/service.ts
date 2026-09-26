import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { and, eq } from 'drizzle-orm'
import { EgressClient } from 'livekit-server-sdk'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { recordings } from '../../../db/schema.js'
import { ConfigurationError, NotFoundError } from '../../../http/errors.js'
import { normalizeR2Endpoint, recordingPatchFromEgress } from './status.js'

type RecordingConfig = Pick<AppConfig, 'livekitUrl' | 'livekitApiKey' | 'livekitApiSecret' | 'r2Endpoint' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>

export function createRecordingService(db: Database, config: RecordingConfig) {
  async function getPlayback(organizationId: string, attemptId: string) {
    let [recording] = await db.select().from(recordings).where(and(eq(recordings.organizationId, organizationId), eq(recordings.attemptId, attemptId))).limit(1)
    if (recording && recording.status !== 'COMPLETED' && config.livekitUrl && config.livekitApiKey && config.livekitApiSecret) {
      const livekitUrl = config.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
      const egresses = await new EgressClient(livekitUrl, config.livekitApiKey, config.livekitApiSecret).listEgress({ egressId: recording.egressId })
      const egress = egresses[0]
      if (egress) {
        const patch = recordingPatchFromEgress(egress)
        await db.update(recordings).set(patch).where(eq(recordings.id, recording.id))
        recording = { ...recording, ...patch }
      }
    }
    if (!recording || recording.status !== 'COMPLETED') throw new NotFoundError('Completed recording')
    if (!config.r2Endpoint || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2BucketName) throw new ConfigurationError('Cloudflare R2')
    const client = new S3Client({ region: 'auto', endpoint: normalizeR2Endpoint(config.r2Endpoint, config.r2BucketName), forcePathStyle: true, credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } })
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.r2BucketName, Key: recording.storageKey }), { expiresIn: 300 })
    return { url, expiresInSeconds: 300, recording: { id: recording.id, mimeType: recording.mimeType, byteSize: recording.byteSize, durationSeconds: recording.durationSeconds } }
  }
  return { getPlayback }
}
export type RecordingService = ReturnType<typeof createRecordingService>
