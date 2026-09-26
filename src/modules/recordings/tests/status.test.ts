import { EgressStatus, type EgressInfo } from '@livekit/protocol'
import { describe, expect, it } from 'vitest'
import { normalizeR2Endpoint, recordingPatchFromEgress } from '../index.js'

describe('recording egress status', () => {
  it('reads current single-file results and preserves recording metadata', () => {
    const patch = recordingPatchFromEgress({
      status: EgressStatus.EGRESS_COMPLETE,
      error: '',
      endedAt: 1_790_444_640_993_136_000n,
      fileResults: [],
      result: { case: 'file', value: { size: 2_415_767n, duration: 156_460_000_001n } },
    } as EgressInfo)

    expect(patch).toMatchObject({
      status: 'COMPLETED',
      errorMessage: null,
      byteSize: 2_415_767,
      durationSeconds: 156,
    })
    expect(patch.completedAt).toBeInstanceOf(Date)
  })

  it('supports legacy fileResults and maps failed egress states', () => {
    const complete = recordingPatchFromEgress({
      status: EgressStatus.EGRESS_COMPLETE,
      error: '', endedAt: 0n,
      result: { case: undefined },
      fileResults: [{ size: 10n, duration: 2_000_000_000n }],
    } as EgressInfo)
    expect(complete).toMatchObject({ status: 'COMPLETED', byteSize: 10, durationSeconds: 2 })

    const failed = recordingPatchFromEgress({
      status: EgressStatus.EGRESS_FAILED,
      error: 'upload failed', endedAt: 0n,
      result: { case: undefined }, fileResults: [],
    } as EgressInfo)
    expect(failed).toMatchObject({ status: 'FAILED', errorMessage: 'upload failed' })
  })

  it('normalizes an R2 endpoint that already includes the bucket path', () => {
    expect(normalizeR2Endpoint('https://account.r2.cloudflarestorage.com/my-bucket', 'my-bucket'))
      .toBe('https://account.r2.cloudflarestorage.com')
    expect(normalizeR2Endpoint('https://account.r2.cloudflarestorage.com', 'my-bucket'))
      .toBe('https://account.r2.cloudflarestorage.com')
  })
})
