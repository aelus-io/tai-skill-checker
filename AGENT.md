# AGENT.md — AI Skill Assessment Backend

## Purpose

This repository contains the **Node.js backend** for an AI-powered workforce skill assessment platform.

Core backend responsibilities:

* authentication and authorization
* assessments, scenarios, competencies, rubrics
* employee invitations and assignments
* attempt lifecycle
* LiveKit realtime sessions
* Gemini Live agent orchestration
* resource retrieval / RAG
* transcripts and recordings
* post-session evaluation
* admin reporting and live inspection

The frontend is maintained separately.

---

# Core Architecture

```text
React Frontend
      │
      ▼
Node API
      │
      ├── Better Auth
      ├── Assessments
      ├── Assignments
      ├── Attempts
      ├── Resources
      ├── Evaluation
      │
      ▼
PostgreSQL + pgvector

LiveKit
   │
   ▼
Node Agent Worker
   │
   ▼
Gemini Live
   │
   ▼
Backend Tools

Recordings ──► Cloudflare R2
Emails ──────► Resend
```

Important rule:

```text
Realtime interviewer ≠ evaluator
```

Gemini Live conducts the conversation.

A separate evaluation process scores the completed transcript against the rubric.

---

# Guiding Principles

1. **Module isolation** — other modules import only from `index.ts`.
2. **Explicit dependencies** — dependency injection over global singletons.
3. **Thin HTTP routes** — validate, authorize, call service, return response.
4. **Strict tenant isolation** — organization-scoped access everywhere.
5. **Persist important state** — never rely only on model conversation memory.
6. **Idempotent operations** — retries must not create duplicate evaluations, attempts, events, or emails.
7. **Keep the prototype small** — avoid unnecessary infrastructure and abstractions.

---

# Repository Structure

```text
src/
├── config/
│   ├── env.ts
│   ├── logger.ts
│   └── index.ts
│
├── db/
│   ├── client.ts
│   └── index.ts
│
├── modules/
│   ├── auth/
│   ├── organizations/
│   ├── assessments/
│   ├── invitations/
│   ├── assignments/
│   ├── attempts/
│   ├── resources/
│   ├── livekit/
│   ├── agent/
│   ├── evaluation/
│   ├── recordings/
│   └── notifications/
│
├── jobs/
│   ├── evaluation/
│   ├── resources/
│   └── notifications/
│
├── http/
│   ├── middleware/
│   ├── routes/
│   └── index.ts
│
├── app.ts
└── index.ts
```

Every module follows:

```text
module-name/
├── components/
├── types/
│   └── index.ts
├── tests/
└── index.ts
```

---

# Module Pattern

`index.ts` contains **exports only**.

Example:

```typescript
export { createAttemptService } from './components/attemptService.js'

export type {
  AttemptService,
  AttemptStatus,
} from './types/index.js'
```

Never import another module's internal files:

```typescript
// wrong
import { something } from '../attempts/components/...'
```

Always use:

```typescript
import { createAttemptService } from '../attempts/index.js'
```

---

# Service Pattern

Use factory functions.

```typescript
export function createAttemptService(
  repository: AttemptRepository,
  assignments: AssignmentService,
) {
  async function startAttempt(input: {
    assignmentId: string
    userId: string
  }) {
    // business logic
  }

  return {
    startAttempt,
  }
}
```

Rules:

* dependencies passed explicitly
* no service singletons
* no DB creation inside services
* no `process.env` reads inside services

---

# Main Domain Model

Use these terms consistently:

```text
Organization
User

Assessment
AssessmentVersion

Scenario
Competency
Rubric

Resource
ResourceChunk

Invitation
Assignment

Attempt
AttemptScenario
AttemptTurn
AttemptEvent

Recording

Evaluation
CompetencyScore
EvaluationEvidence
```

### Assessment

Defines the skill assessment.

### Scenario

A realistic workplace problem.

### Competency

The skill being measured.

### Rubric

Defines scoring criteria.

### Assignment

Connects an employee to an assessment.

### Attempt

One actual assessment session.

---

# Assessment Versioning

Published assessments must be immutable.

```text
Assessment
   ↓
AssessmentVersion
   ↓
Scenarios + Rubrics
```

An attempt must always reference the exact assessment version used.

Do not modify an assessment version after employees begin using it.

---

# Attempt State Machine

Use:

```text
READY
  ↓
IN_PROGRESS
  ↓
PROCESSING
  ↓
COMPLETED
```

Other terminal states:

```text
FAILED
EXPIRED
```

Transitions must go through a state-machine function.

Do not update statuses randomly throughout the codebase.

---

# Attempt Limit Rule

Opening the preparation page does **not** consume an attempt.

The attempt is consumed when the actual realtime assessment begins.

Attempt-limit enforcement must happen on the backend.

---

# Organization Security

`organizationId` comes from trusted authenticated context.

Never trust this:

```json
{
  "organizationId": "..."
}
```

from the frontend for authorization.

Every organization-owned query must be scoped.

```typescript
await db.assessment.findFirst({
  where: {
    id: assessmentId,
    organizationId,
  },
})
```

---

# LiveKit Pattern

Backend controls:

* room creation
* room names
* participant tokens
* permissions
* agent dispatch
* recordings
* observer access

Use room names like:

```text
assessment-attempt-{attemptId}
```

Employee token:

```text
publish microphone
subscribe true
```

Admin observer:

```text
publish false
subscribe true
```

Tokens must be short-lived and created server-side.

---

# Agent Pattern

Realtime flow:

```text
LiveKit Room
    ↓
Node Agent Worker
    ↓
Gemini Live
    ↓
Backend Tools
```

The realtime agent handles:

* conversation
* scenarios
* follow-up questions
* resource retrieval
* scenario progression

It does **not** produce the authoritative final score.

---

# Agent Tools

Keep tools small.

Recommended:

```text
getAssessmentContext
getCurrentScenario
retrieveResource
recordAssessmentEvent
completeScenario
completeAssessment
```

Trusted context is injected when creating tools.

Example:

```typescript
createRetrieveResourceTool(
  {
    organizationId,
    assessmentId,
    attemptId,
  },
  resourceService,
)
```

The model must never provide authoritative:

```text
organizationId
attemptId
userId
```

---

# Resource / RAG Pattern

Use:

```text
PostgreSQL + pgvector
```

Pipeline:

```text
PDF
 ↓
extract text
 ↓
chunk
 ↓
embed
 ↓
pgvector
```

Retrieval must always be scoped by:

```text
organizationId
+
assessmentId
```

Never search globally across organizations.

---

# Transcript Pattern

Persist transcript turns.

```text
AttemptTurn

id
attemptId
speaker
content
sequence
startedAt
endedAt
```

Speakers:

```text
EMPLOYEE
AGENT
SYSTEM
```

The database is the system of record, not the model session history.

---

# Session Recovery

Persist enough state to continue after connection loss:

```text
currentScenarioId
completedScenarioIds
lastHeartbeatAt
roomName
attemptStatus
```

On reconnect, rebuild context from persisted state.

Do not repeat completed scenarios.

---

# Evaluation Pattern

Evaluation happens **after** the realtime session.

Inputs:

```text
assessment version
scenarios
rubrics
transcript
relevant resources
```

Output:

```json
{
  "competencies": [
    {
      "competencyId": "privacy-awareness",
      "score": 4,
      "maxScore": 5,
      "reasoning": "...",
      "evidence": [
        {
          "turnId": "turn_17",
          "reason": "..."
        }
      ]
    }
  ]
}
```

Rules:

* use structured model output
* validate with Zod
* scores must contain evidence
* evaluation must be retryable
* evaluation must not create duplicates

---

# Recording Pattern

Store recordings privately in Cloudflare R2.

```text
recordings/
  {organizationId}/
    {assessmentId}/
      {attemptId}/
        recording.ogg
```

Database stores only metadata.

Never expose permanent public recording URLs.

Admin playback flow:

```text
authorize
   ↓
generate short-lived signed URL
   ↓
return URL
```

---

# HTTP Pattern

Routes stay thin.

```typescript
app.post('/assignments/:id/attempts', async (req, res) => {
  const input = schema.parse(req.body)
  const session = requireSession(req)

  const result = await attemptService.startAttempt({
    assignmentId: req.params.id,
    userId: session.user.id,
  })

  return res.status(201).send(result)
})
```

Business logic belongs in services, not routes.

---

# Error Pattern

Use typed domain errors.

```typescript
export class AttemptLimitReachedError extends Error {
  readonly code = 'ATTEMPT_LIMIT_REACHED'

  constructor() {
    super('Maximum number of attempts reached')
  }
}
```

HTTP middleware maps them to status codes.

Never expose internal provider errors directly.

---

# Logging

Use Pino.

Useful context:

```text
requestId
organizationId
userId
assessmentId
assignmentId
attemptId
roomName
```

Example:

```typescript
logger.info(
  { organizationId, attemptId },
  'Assessment started',
)
```

Never log:

* auth tokens
* API secrets
* magic links
* complete transcripts at info level
* signed R2 URLs

---

# Jobs

Slow or retryable tasks should run as jobs:

```text
process resource
evaluate attempt
send invitation
```

Jobs should contain IDs, not large objects.

```typescript
type EvaluateAttemptJob = {
  attemptId: string
}
```

Workers load authoritative data from the database.

---

# Configuration

Parse environment variables once at startup using Zod.

```typescript
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(1),

  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),

  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
})
```

Never scatter `process.env` reads around the repository.

---

# TypeScript Rules

Use strict TypeScript.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

No `any` in production code.

Use `unknown` and narrow it.

---

# Testing

Use Vitest.

Prioritize tests for:

```text
attempt limits
attempt state transitions
organization isolation
assessment versioning
resource scoping
LiveKit authorization
session recovery
evaluation validation
recording authorization
```

Mock external providers:

```text
LiveKit
Gemini
Resend
R2
```

Test pure business logic directly.

---

# Prototype Scope

Do **not** build unless required:

```text
MCP
SAML
SCIM
complex RBAC
video interviews
HRIS integrations
Teams / Slack integrations
multi-region infrastructure
custom WebRTC
custom STT/TTS
multiple AI providers
advanced analytics
```

Focus on:

```text
create assessment
      ↓
invite employee
      ↓
run reliable Gemini Live assessment
      ↓
store transcript + recording
      ↓
evaluate independently
      ↓
show evidence-backed result
```

---

# Coding Rules

When changing this repository:

1. Preserve module boundaries.
2. Import only through module `index.ts`.
3. Keep routes thin.
4. Inject dependencies.
5. Keep tenant checks server-side.
6. Persist realtime state.
7. Keep interviewer and evaluator separate.
8. Validate all model output.
9. Add tests for changed business logic.
10. Do not introduce unnecessary abstractions.
11. Do not introduce MCP unless a real integration needs it.
12. Prefer reliable core behavior over extra features.

## Core Principle

Build the smallest backend that can reliably prove:

> Can this employee apply the AI skills they were trained on, and what evidence supports that result?
