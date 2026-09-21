import { describe, expect, it } from 'vitest'
import { parseDispatchMetadata } from '../../../agent.js'

describe('agent dispatch metadata', () => {
  it('accepts the trusted identifiers sent by explicit dispatch', () => {
    expect(parseDispatchMetadata(JSON.stringify({ organizationId: 'org', assessmentId: 'assessment', assessmentVersionId: 'version', attemptId: 'attempt' }))).toEqual({ organizationId: 'org', assessmentId: 'assessment', assessmentVersionId: 'version', attemptId: 'attempt' })
  })

  it('rejects malformed or incomplete metadata before joining the room', () => {
    expect(() => parseDispatchMetadata('{}')).toThrow('organizationId')
    expect(() => parseDispatchMetadata(JSON.stringify({ organizationId: '', assessmentId: 'assessment', assessmentVersionId: 'version', attemptId: 'attempt' }))).toThrow('organizationId')
    expect(() => parseDispatchMetadata('not-json')).toThrow()
  })
})
