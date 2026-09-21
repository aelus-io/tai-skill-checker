# BACKEND_TASKS.md

> Backend only. Follow `backend/AGENT.md` before making changes.
>
> Stack changes:
> - ORM: **Drizzle ORM**
> - Database: **Neon PostgreSQL**
> - Vector search: **pgvector on Neon**
> - Runtime/API: **Node.js + Express + TypeScript**

## Phase 1 — Foundation + Core Domain

Goal: get the backend structure, database, auth, and assessment domain working.

### Tasks

- Set up Node.js + Express + strict TypeScript.
- Add config validation with Zod and structured logging with Pino.
- Set up Neon PostgreSQL and Drizzle ORM.
- Add Drizzle migrations and database bootstrap.
- Enable pgvector support.
- Implement Better Auth.
- Support roles:
  - `ADMIN`
  - `EMPLOYEE`
- Keep one organization internally, but include `organizationId` on tenant-owned records.

### Core schema

Implement the minimum required tables:

- `organizations`
- `users`
- `organization_memberships`
- `assessments`
- `assessment_versions`
- `scenarios`
- `competencies`
- `rubrics`
- `scenario_competencies`
- `resources`
- `resource_chunks`
- `invitations`
- `assignments`
- `attempts`
- `attempt_scenarios`
- `attempt_turns`
- `attempt_events`
- `recordings`
- `evaluations`
- `competency_scores`
- `evaluation_evidence`

### Assessment functionality

Implement:

- create/edit draft assessment
- manually add scenarios, competencies, and rubrics
- AI-assisted generation of assessment content
- upload PDF resource
- publish assessment
- immutable published assessment versions
- list/get assessments

### Invitations

Implement:

- invite multiple employee emails to one assessment
- create assignment per employee
- send invitation email with Resend
- invitation link acts as employee entry/auth flow
- invitation expiration

### Done when

- admin can authenticate
- admin can create a complete draft assessment
- PDF can be uploaded and stored
- assessment can be published
- multiple employee invitations can be created and sent
- employee can enter through an invitation
- migrations work from a clean Neon database

---

## Phase 2 — Attempts + LiveKit + Gemini Live

Goal: complete the realtime assessment flow.

### Attempt rules

Default maximum attempts:

```env
MAX_ASSESSMENT_ATTEMPTS=3
```

Rules:

- preparation page does not consume an attempt
- attempt is consumed when the realtime session starts
- interrupted/stopped/disconnected attempt becomes `ABANDONED`
- restarting consumes another attempt
- no reconnect/resume for the prototype
- after one successful completion, assignment is locked permanently

Attempt states:

```text
READY
IN_PROGRESS
PROCESSING
COMPLETED
ABANDONED
FAILED
EXPIRED
```

Attempt creation/counting must be concurrency-safe.

### LiveKit

Implement backend support for:

- creating/authorizing assessment rooms
- short-lived employee tokens
- listen-only admin observer tokens
- agent dispatch
- audio-only recording
- recording metadata
- LiveKit webhooks where needed

Room naming:

```text
assessment-attempt-{attemptId}
```

### Gemini Live agent

Implement Node LiveKit agent worker using Gemini Live.

Fixed scenario order with adaptive follow-ups.

Agent tools:

- `getAssessmentContext`
- `getCurrentScenario`
- `retrieveResource`
- `recordAssessmentEvent`
- `completeScenario`
- `completeAssessment`

Trusted IDs must be injected by the backend, never accepted from the model as authoritative input.

### Resource retrieval

Implement PDF processing:

```text
PDF
→ extract text
→ chunk
→ embed
→ Neon pgvector
```

Retrieval must always be scoped by:

```text
organizationId + assessmentId
```

Resources must be available to both:

- realtime interviewer
- evaluator

### Transcript + events

Persist:

- employee turns
- agent turns
- system turns
- scenario progress
- tool/lifecycle events

Database is the source of truth, not Gemini session memory.

### Recording

Store audio recordings privately in Cloudflare R2.

Use short-lived signed URLs for admin playback.

### Admin live inspection support

Expose backend data/access for:

- active attempts
- employee
- current scenario
- current agent state
- live transcript
- listen-only audio access

### Done when

One employee can:

```text
open invitation
→ prepare
→ start attempt
→ speak with Gemini Live
→ progress through fixed scenarios
→ trigger RAG retrieval
→ complete assessment
```

And the backend reliably stores:

- attempt state
- scenario progress
- transcript
- events
- audio recording metadata

---

## Phase 3 — Evaluation + Reports + Hardening

Goal: finish the assessment loop and make the prototype reliable enough to demo.

### Independent evaluation

Do not use the realtime interviewer as the final evaluator.

After successful completion:

```text
IN_PROGRESS
→ PROCESSING
→ evaluator runs
→ COMPLETED
```

Use a separate non-realtime Gemini model.

Evaluator inputs:

- exact assessment version
- scenarios
- competencies
- rubrics
- transcript
- relevant resource content

Output:

- overall score
- competency scores
- strengths
- gaps
- transcript-backed evidence
- recommended training / next steps

Internal scoring:

```text
1–5
```

Validate all model output with Zod.

Every competency score must include supporting evidence.

Evaluation must be retryable and idempotent.

### Admin report APIs

Expose:

- overall result
- competency scores
- percentage conversion if needed
- strengths
- gaps
- recommendations
- evidence
- transcript
- recording signed URL

Employees must not be able to access reports.

### Reliability + security

Finish:

- typed application errors
- global Express error handler
- request validation
- health endpoint
- organization-scoped authorization
- idempotent webhook handling
- atomic attempt-limit enforcement
- duplicate evaluation prevention
- duplicate invitation protection where appropriate
- private R2 access
- short-lived LiveKit tokens
- structured Pino logs
- graceful shutdown

### Tests

Prioritize only critical tests:

- organization isolation
- assessment publishing/version immutability
- attempt limit and concurrency
- interrupted attempt consumes an attempt
- completed assignment cannot be retried
- LiveKit token authorization
- RAG organization/assessment scoping
- evaluator schema validation
- duplicate evaluation protection
- employee cannot access reports
- recording access authorization

### Done when

The complete prototype works:

```text
Admin creates/publishes assessment
→ uploads PDF
→ invites employees
→ employee completes Gemini Live assessment
→ transcript + audio stored
→ independent evaluator scores it
→ admin sees evidence-backed report
→ admin can inspect a live attempt
```

---

# Build Order Rule

Within each phase:

1. schema/domain first
2. service logic second
3. HTTP/API third
4. external integrations fourth
5. tests for critical behavior last

Do not start the next phase until the current phase's end-to-end flow works.

# Prototype Rule

Do not add:

- MCP
- Redis/BullMQ unless actually required
- SAML/SCIM
- complex RBAC
- video
- HRIS integrations
- Slack/Teams
- custom WebRTC
- custom STT/TTS
- multiple AI providers
- advanced analytics

Build the smallest reliable backend that completes the assessment loop.
