import { TokenVerifier } from 'livekit-server-sdk'
import { describe, expect, it } from 'vitest'
import { createParticipantToken } from '../index.js'

const key = 'test-key'
const secret = 'test-secret-that-is-long-enough-for-signing'

describe('LiveKit participant authorization', () => {
  it('allows an employee to publish only inside the assigned room', async () => {
    const jwt = await createParticipantToken({ apiKey: key, apiSecret: secret, ttlSeconds: 300, roomName: 'assessment-attempt-123', identity: 'employee-user', metadata: { attemptId: '123' }, observer: false })
    const claims = await new TokenVerifier(key, secret).verify(jwt)
    expect(claims.video).toMatchObject({ room: 'assessment-attempt-123', roomJoin: true, canPublish: true, canSubscribe: true })
  })

  it('makes admin observers hidden and listen only', async () => {
    const jwt = await createParticipantToken({ apiKey: key, apiSecret: secret, ttlSeconds: 300, roomName: 'assessment-attempt-123', identity: 'observer-admin', metadata: { attemptId: '123' }, observer: true })
    const claims = await new TokenVerifier(key, secret).verify(jwt)
    expect(claims.video).toMatchObject({ room: 'assessment-attempt-123', roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true })
  })
})
