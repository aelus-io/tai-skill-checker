import { and, eq } from 'drizzle-orm'
import { AccessToken, AgentDispatchClient, EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient, S3Upload, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { attempts, recordings } from '../../../db/schema.js'
import { ConfigurationError, ConflictError, NotFoundError } from '../../../http/errors.js'
import type { StartedAttempt } from '../../attempts/index.js'

type LiveKitConfig = Pick<AppConfig, 'livekitUrl' | 'livekitApiKey' | 'livekitApiSecret' | 'livekitAgentName' | 'livekitTokenTtlSeconds' | 'r2Endpoint' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>

export async function createParticipantToken(input: { apiKey: string; apiSecret: string; ttlSeconds: number; roomName: string; identity: string; metadata: Record<string, string>; observer: boolean }) {
  const access = new AccessToken(input.apiKey, input.apiSecret, { identity: input.identity, ttl: input.ttlSeconds, metadata: JSON.stringify(input.metadata) })
  access.addGrant({ roomJoin: true, room: input.roomName, canSubscribe: true, canPublish: !input.observer, canPublishData: !input.observer, hidden: input.observer })
  return access.toJwt()
}

export function createLiveKitService(db: Database, config: LiveKitConfig) {
  function requireConfig() {
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) throw new ConfigurationError('LiveKit')
    return { url: config.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), participantUrl: config.livekitUrl, key: config.livekitApiKey, secret: config.livekitApiSecret }
  }

  async function token(roomName: string, identity: string, metadata: Record<string, string>, observer: boolean) {
    const livekit = requireConfig()
    return createParticipantToken({ apiKey: livekit.key, apiSecret: livekit.secret, ttlSeconds: config.livekitTokenTtlSeconds, roomName, identity, metadata, observer })
  }

  async function provision(attempt: StartedAttempt) {
    const livekit = requireConfig()
    if (!config.r2Endpoint || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2BucketName) throw new ConfigurationError('Cloudflare R2 recording')
    const roomClient = new RoomServiceClient(livekit.url, livekit.key, livekit.secret)
    const dispatchClient = new AgentDispatchClient(livekit.url, livekit.key, livekit.secret)
    const egressClient = new EgressClient(livekit.url, livekit.key, livekit.secret)
    await roomClient.createRoom({ name: attempt.roomName, emptyTimeout: 60, departureTimeout: 0, maxParticipants: 4 })
    try {
      await dispatchClient.createDispatch(attempt.roomName, config.livekitAgentName, { metadata: JSON.stringify({ organizationId: attempt.organizationId, assessmentId: attempt.assessmentId, assessmentVersionId: attempt.assessmentVersionId, attemptId: attempt.id }) })
      const storageKey = `recordings/${attempt.organizationId}/${attempt.assessmentId}/${attempt.id}/recording.ogg`
      const output = new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath: storageKey, output: { case: 's3', value: new S3Upload({ accessKey: config.r2AccessKeyId, secret: config.r2SecretAccessKey, endpoint: config.r2Endpoint, bucket: config.r2BucketName, region: 'auto', forcePathStyle: true }) } })
      const egress = await egressClient.startRoomCompositeEgress(attempt.roomName, output, { audioOnly: true })
      await db.insert(recordings).values({ organizationId: attempt.organizationId, attemptId: attempt.id, storageKey, mimeType: 'audio/ogg', egressId: egress.egressId, status: 'ACTIVE' })
      return { token: await token(attempt.roomName, `employee-${attempt.employeeUserId}`, { role: 'employee', attemptId: attempt.id }, false), url: livekit.participantUrl }
    } catch (error) {
      await roomClient.deleteRoom(attempt.roomName).catch(() => undefined)
      throw error
    }
  }

  async function observerToken(input: { organizationId: string; attemptId: string; adminUserId: string }) {
    const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, input.organizationId))).limit(1)
    if (!attempt?.roomName) throw new NotFoundError('Active attempt')
    if (!['IN_PROGRESS', 'PROCESSING'].includes(attempt.status)) throw new ConflictError('ATTEMPT_NOT_ACTIVE', 'Attempt is not active')
    const livekit = requireConfig()
    return { url: livekit.participantUrl, token: await token(attempt.roomName, `observer-${input.adminUserId}-${Date.now()}`, { role: 'observer', attemptId: attempt.id }, true) }
  }

  function receiver() { const c = requireConfig(); return new WebhookReceiver(c.key, c.secret) }
  async function receiveWebhook(body: string, authorization?: string) { return receiver().receive(body, authorization) }

  async function applyRecordingWebhook(event: WebhookEvent) {
    const info = event.egressInfo
    if (!info?.egressId) return
    const [recording] = await db.select().from(recordings).where(eq(recordings.egressId, info.egressId)).limit(1)
    if (!recording) return
    if (event.event === 'egress_started' || event.event === 'egress_updated') {
      await db.update(recordings).set({ status: 'ACTIVE' }).where(eq(recordings.id, recording.id))
    } else if (event.event === 'egress_ended') {
      const failed = info.error !== ''
      const file = info.fileResults[0]
      await db.update(recordings).set({
        status: failed ? 'FAILED' : 'COMPLETED', errorMessage: failed ? info.error.slice(0, 1000) : null,
        completedAt: new Date(), ...(file ? { byteSize: Number(file.size), durationSeconds: Math.round(Number(file.duration) / 1_000_000_000) } : {}),
      }).where(eq(recordings.id, recording.id))
    }
  }

  return { provision, observerToken, receiveWebhook, applyRecordingWebhook }
}
export type LiveKitService = ReturnType<typeof createLiveKitService>
