import { EgressStatus, type EgressInfo } from '@livekit/protocol'
import { eq } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import { recordings } from '../../../db/schema.js'

function completedAt(info: EgressInfo) {
  return info.endedAt > 0n ? new Date(Number(info.endedAt / 1_000_000n)) : new Date()
}

export function recordingPatchFromEgress(info: EgressInfo) {
  if (info.status === EgressStatus.EGRESS_COMPLETE) {
    const file = info.result.case === 'file' ? info.result.value : info.fileResults[0]
    return {
      status: 'COMPLETED' as const,
      errorMessage: null,
      completedAt: completedAt(info),
      ...(file ? {
        byteSize: Number(file.size),
        durationSeconds: Math.round(Number(file.duration) / 1_000_000_000),
      } : {}),
    }
  }

  if (
    info.status === EgressStatus.EGRESS_FAILED
    || info.status === EgressStatus.EGRESS_ABORTED
    || info.status === EgressStatus.EGRESS_LIMIT_REACHED
  ) {
    return {
      status: 'FAILED' as const,
      errorMessage: (info.error || 'LiveKit recording failed').slice(0, 1_000),
      completedAt: completedAt(info),
    }
  }

  if (info.status === EgressStatus.EGRESS_ACTIVE || info.status === EgressStatus.EGRESS_ENDING) {
    return { status: 'ACTIVE' as const }
  }
  return { status: 'STARTING' as const }
}

export async function syncRecordingFromEgress(db: Database, info: EgressInfo) {
  if (!info.egressId) return
  await db.update(recordings)
    .set(recordingPatchFromEgress(info))
    .where(eq(recordings.egressId, info.egressId))
}

export function normalizeR2Endpoint(endpoint: string, bucket: string) {
  const url = new URL(endpoint)
  if (url.pathname.replace(/\/$/, '') === `/${bucket}`) url.pathname = '/'
  return url.toString().replace(/\/$/, '')
}
