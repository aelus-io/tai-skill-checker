export type AttemptStatus = 'READY' | 'IN_PROGRESS' | 'PROCESSING' | 'COMPLETED' | 'ABANDONED' | 'FAILED' | 'EXPIRED'
export type AttemptSpeaker = 'EMPLOYEE' | 'AGENT' | 'SYSTEM'

export type StartedAttempt = {
  id: string
  organizationId: string
  assessmentId: string
  assessmentVersionId: string
  employeeUserId: string
  roomName: string
  attemptNumber: number
}
