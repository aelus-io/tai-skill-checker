import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { EgressStatus, ParticipantInfo_Kind } from '@livekit/protocol'
import { AccessToken, AgentDispatchClient, EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient, S3Upload, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { attempts, recordings } from '../../../db/schema.js'
import { AppError, ConfigurationError, ConflictError, NotFoundError } from '../../../http/errors.js'
import type { StartedAttempt } from '../../attempts/index.js'

type LiveKitConfig = Pick<AppConfig, 'livekitUrl' | 'livekitApiKey' | 'livekitApiSecret' | 'livekitAgentName' | 'livekitTokenTtlSeconds' | 'r2Endpoint' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>

const provisioningTimeoutMs = 15_000
const provisioningPollIntervalMs = 250

async function pause(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function waitForRealtimeInfrastructure(input: {
  roomName: string
  egressId: string
  roomClient: Pick<RoomServiceClient, 'listParticipants'>
  egressClient: Pick<EgressClient, 'listEgress'>
  timeoutMs?: number
  pollIntervalMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? provisioningTimeoutMs
  const pollIntervalMs = input.pollIntervalMs ?? provisioningPollIntervalMs
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const [participants, egresses] = await Promise.all([
      input.roomClient.listParticipants(input.roomName),
      input.egressClient.listEgress({ egressId: input.egressId }),
    ])
    const egress = egresses[0]
    if (egress?.status === EgressStatus.EGRESS_FAILED || egress?.status === EgressStatus.EGRESS_ABORTED || egress?.status === EgressStatus.EGRESS_LIMIT_REACHED) {
      throw new Error(`LiveKit recording failed to start${egress.error ? `: ${egress.error}` : ''}`)
    }
    if (
      participants.some((participant) => participant.kind === ParticipantInfo_Kind.AGENT)
      && (egress?.status === EgressStatus.EGRESS_STARTING || egress?.status === EgressStatus.EGRESS_ACTIVE)
    ) return egress.status
    await pause(pollIntervalMs)
  }

  throw new Error('LiveKit agent or recording did not become ready before the session startup timeout')
}

export async function waitForAgentParticipant(input: {
  roomName: string
  roomClient: Pick<RoomServiceClient, 'listParticipants'>
  timeoutMs?: number
  pollIntervalMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? provisioningTimeoutMs
  const pollIntervalMs = input.pollIntervalMs ?? provisioningPollIntervalMs
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const participants = await input.roomClient.listParticipants(input.roomName)
    if (participants.some((participant) => participant.kind === ParticipantInfo_Kind.AGENT)) return
    await pause(pollIntervalMs)
  }
  throw new AppError('AGENT_NOT_READY', 'The voice agent worker did not join the test room. Verify that the API and agent worker use the same unique LIVEKIT_AGENT_NAME.', 503)
}

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
      const egressStatus = await waitForRealtimeInfrastructure({ roomName: attempt.roomName, egressId: egress.egressId, roomClient, egressClient })
      await db.insert(recordings).values({
        organizationId: attempt.organizationId,
        attemptId: attempt.id,
        storageKey,
        mimeType: 'audio/ogg',
        egressId: egress.egressId,
        status: egressStatus === EgressStatus.EGRESS_ACTIVE ? 'ACTIVE' : 'STARTING',
      })
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

  async function createAgentTestSession(input: { organizationId: string; adminUserId: string }) {
    const livekit = requireConfig()
    const roomName = `agent-test-${input.organizationId}-${randomUUID()}`
    const roomClient = new RoomServiceClient(livekit.url, livekit.key, livekit.secret)
    const dispatchClient = new AgentDispatchClient(livekit.url, livekit.key, livekit.secret)
    await roomClient.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 10, maxParticipants: 2 })
    try {
      await dispatchClient.createDispatch(roomName, config.livekitAgentName, { metadata: JSON.stringify({ mode: 'test', organizationId: input.organizationId }) })
      await waitForAgentParticipant({ roomName, roomClient })
      return { roomName, url: livekit.participantUrl, token: await token(roomName, `admin-test-${input.adminUserId}-${Date.now()}`, { role: 'admin-test' }, false) }
    } catch (error) {
      await roomClient.deleteRoom(roomName).catch(() => undefined)
      throw error
    }
  }

  async function closeAgentTestSession(input: { organizationId: string; roomName: string }) {
    const expectedPrefix = `agent-test-${input.organizationId}-`
    if (!input.roomName.startsWith(expectedPrefix)) throw new NotFoundError('Agent test session')
    await closeRooms([input.roomName])
  }

  async function closeRooms(roomNames: string[]) {
    if (!roomNames.length) return
    const livekit = requireConfig()
    const roomClient = new RoomServiceClient(livekit.url, livekit.key, livekit.secret)
    await Promise.allSettled([...new Set(roomNames)].map((roomName) => roomClient.deleteRoom(roomName)))
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

  return { provision, observerToken, createAgentTestSession, closeAgentTestSession, closeRooms, receiveWebhook, applyRecordingWebhook }
}
export type LiveKitService = ReturnType<typeof createLiveKitService>
