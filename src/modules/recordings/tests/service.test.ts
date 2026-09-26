import { EgressStatus } from '@livekit/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../../db/index.js'

const { getSignedUrl, listEgress } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
  listEgress: vi.fn(),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))
vi.mock('livekit-server-sdk', () => ({
  EgressClient: class { listEgress = listEgress },
}))

import { createRecordingService } from '../index.js'

describe('recording playback', () => {
  beforeEach(() => {
    getSignedUrl.mockReset().mockResolvedValue('https://signed.example/recording')
    listEgress.mockReset()
  })

  it('reconciles a completed LiveKit egress before returning a stale recording', async () => {
    const limit = vi.fn().mockResolvedValue([{
      id: 'recording-1', organizationId: 'organization-1', attemptId: 'attempt-1',
      egressId: 'egress-1', storageKey: 'recordings/attempt-1/recording.ogg',
      status: 'STARTING', mimeType: 'audio/ogg', byteSize: null, durationSeconds: null,
    }])
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    } as unknown as Database
    listEgress.mockResolvedValue([{
      egressId: 'egress-1', status: EgressStatus.EGRESS_COMPLETE, error: '', endedAt: 1n,
      fileResults: [], result: { case: 'file', value: { size: 42n, duration: 3_000_000_000n } },
    }])

    const service = createRecordingService(db, {
      livekitUrl: 'wss://example.livekit.cloud', livekitApiKey: 'key', livekitApiSecret: 'secret',
      r2Endpoint: 'https://account.r2.cloudflarestorage.com/bucket',
      r2AccessKeyId: 'access', r2SecretAccessKey: 'secret', r2BucketName: 'bucket',
    })

    await expect(service.getPlayback('organization-1', 'attempt-1')).resolves.toMatchObject({
      url: 'https://signed.example/recording',
      recording: { id: 'recording-1', byteSize: 42, durationSeconds: 3 },
    })
    expect(listEgress).toHaveBeenCalledWith({ egressId: 'egress-1' })
    expect(updateWhere).toHaveBeenCalledOnce()
  })
})
