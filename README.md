# TAI Skill Checker Backend

Backend for creating, assigning, and running realtime AI skill assessments.

## Stack

- Node.js 22+, Express 5, strict TypeScript
- Neon PostgreSQL, Drizzle ORM, pgvector
- Better Auth with password access for the configured admin and invitation-scoped magic links for employees
- Gemini structured generation
- Resend invitation delivery
- Pino logging, Zod validation, Vitest
- LiveKit rooms, agent dispatch, audio egress, and verified webhooks
- Gemini Live interviewer and Gemini embeddings
- Anthropic post-interview evaluation through the official TypeScript SDK
- Private Cloudflare R2 recordings

## Setup

1. Copy `.env.example` to `.env` and configure the database and auth settings. Realtime assessments also require Gemini, LiveKit, and all R2 settings. Post-interview evaluation requires `ANTHROPIC_API_KEY` plus either `ANTHROPIC_MODEL` or the evaluation-specific `ANTHROPIC_EVALUATION_MODEL`. An Anthropic-compatible AWS gateway can also set `ANTHROPIC_BASE_URL`, `ANTHROPIC_WORKSPACE_ID`, and `ANTHROPIC_WORKSPACE_HEADER`. Resend is required for invitations.
2. Install dependencies and migrate a clean Neon database:

   ```sh
   npm install
   npm run db:migrate
   ```

   The initial migration enables the Neon `vector` extension. Published assessment rows are protected by database triggers as well as the API.

3. Start and verify the API:

   ```sh
   npm run dev
   npm run agent:dev
   npm run typecheck
   npm test
   npm run build
   ```

## Docker deployment

Build one production image for both backend processes:

```sh
docker build -t tai-skill-checker-backend .
```

Run the HTTP API with the image's default command:

```sh
docker run --rm --env-file .env -p 3000:3000 tai-skill-checker-backend
```

Run the LiveKit worker from the same image by overriding the command:

```sh
docker run --rm --env-file .env tai-skill-checker-backend node dist/agent-worker.js start
```

For Dokploy, create one Docker Compose service from `compose.yaml`. Add the production environment variables in Dokploy, route the public API domain to the `api` service on port `3000`, and do not add a domain to `worker`. The worker has a 15-minute graceful shutdown window so active calls can drain. The named `uploads` volume preserves uploaded assessment resources across API container replacements.

Validate the resolved deployment locally with environment values from `.env`:

```sh
docker compose --env-file .env config
```

Apply database migrations once per release, before starting the new API version:

```sh
docker run --rm --env-file .env tai-skill-checker-backend npm run db:migrate:prod
```

## Administrator provisioning

Set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ORGANIZATION_NAME`, and `ORGANIZATION_SLUG` before starting the API. Startup idempotently creates the configured Better Auth user and ensures that user has the `ADMIN` membership in the single organization. Public password sign-up is disabled. `ADMIN_PASSWORD` is used only when the admin user is first created; changing it later does not reset an existing password.

Employees do not use passwords. Invitation delivery sends a short-lived Better Auth magic link. Verification creates the employee session and redirects to the invitation preview, where the employee must explicitly accept before any membership or assignment access is granted.

After acceptance, employees can request a fresh one-time sign-in link using their email address. The employee dashboard lists every assignment bound to that account, including remaining attempts and whether another attempt is available. Successful completion remains final unless an administrator explicitly reinvites and resets the assignment.

## API flow

All admin endpoints require a Better Auth session cookie and an `ADMIN` organization membership.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Database backed health check |
| `GET/POST` | `/api/assessments` | List or create assessments |
| `GET/PUT` | `/api/assessments/:id` | Read or edit the current draft |
| `POST/PUT` | `/api/assessments/:id/scenarios[/scenarioId]` | Add or edit a draft scenario |
| `POST/PUT` | `/api/assessments/:id/competencies[/competencyId]` | Add or edit a draft competency |
| `POST/PUT` | `/api/assessments/:id/rubrics[/rubricId]` | Add or edit a draft rubric |
| `POST` | `/api/assessments/:id/scenario-competencies` | Map a draft scenario to a competency |
| `POST` | `/api/assessments/:id/generate` | Replace draft content with validated Gemini output |
| `POST` | `/api/assessments/:id/resources` | Upload a PDF as multipart field `file` |
| `POST` | `/api/assessments/:id/publish` | Atomically create an immutable version |
| `GET` | `/api/assessments/:id/versions/:versionId` | Read one exact published version |
| `POST` | `/api/assessments/:id/invitations` | Create assignments and send email invitations |
| `GET` | `/api/assessments/:id/invitations` | List invited employees and their current attempt allowance |
| `POST` | `/api/assessments/:id/invitations/:invitationId/reinvite` | Rotate the invitation and grant a fresh attempt allowance |
| `GET` | `/api/invitations/:token` | Read employee safe invitation preview |
| `POST` | `/api/invitations/:token/sign-in` | Send a fresh invitation-scoped employee magic link |
| `POST` | `/api/invitations/:token/accept` | Bind the assignment to the matching signed in employee |
| `GET` | `/api/assignments` | List assignments belonging to the authenticated employee |
| `GET` | `/api/assignments/:id/preparation` | Read preparation details without consuming an attempt |
| `POST` | `/api/assignments/:id/attempts` | Atomically consume an attempt and start its LiveKit session |
| `POST` | `/api/attempts/:id/abandon` | Persist an employee-ended attempt and close its LiveKit room |
| `GET` | `/api/admin/attempts/active` | List live attempts for the organization |
| `GET` | `/api/admin/attempts/:id` | Read scenario progress, transcript, and lifecycle events |
| `GET` | `/api/admin/evaluations` | List organization evaluations, optionally filtered by status and assessment |
| `POST` | `/api/admin/evaluations/:id/retry` | Return one failed evaluation to the durable queue |
| `POST` | `/api/admin/attempts/:id/observer-token` | Create a short lived, listen only admin token |
| `GET` | `/api/admin/attempts/:id/recording` | Create a short lived R2 playback URL |
| `POST` | `/api/webhooks/livekit` | Receive signed LiveKit lifecycle and egress events |

Generation accepts a `brief` and optional `sourceText`. It returns and persists editable scenarios, competencies, mappings, and rubrics. Publication requires every scenario to have a valid competency mapping and every competency to have a rubric.

Invitation recipients follow the emailed magic link, which verifies their email and creates a Better Auth session, then explicitly accept the invitation. Acceptance consumes the invitation secret, creates the employee membership, and binds the assignment to that user. Preview responses expose competencies but omit scenarios and rubrics. A logged-out recipient can request a fresh magic link from the invitation page.

PDF uploads are extracted, chunked, embedded, and stored in pgvector when Gemini is configured. A failed or previously unconfigured resource can be retried with `POST /api/assessments/:assessmentId/resources/:resourceId/process`. Publication requires every uploaded resource to be ready and snapshots its chunks into the immutable version.

Run the API and agent worker as separate processes. Starting an attempt creates `assessment-attempt-{attemptId}`, dispatches the named worker, begins audio only egress to private R2, and returns a five minute employee token. Leaving the room makes an active attempt `ABANDONED`; a new start consumes the next attempt. Calling the agent's completion tool locks the assignment, moves the attempt to `PROCESSING`, and creates its unique evaluation queue row in the same transaction.

The API process also runs the database-backed evaluation worker. It atomically claims queued rows, recovers claims older than ten minutes after a crash, and validates all Anthropic output against the exact published version and employee transcript turns. Valid results and the `PROCESSING -> COMPLETED` attempt transition commit together. Invalid output, missing configuration, and provider failures leave the transcript intact and create a sanitized `FAILED` evaluation that an admin can retry. Manually ended or disconnected attempts never enter this queue.

## Domain guarantees

- `organizationId` is derived from the authenticated membership and never accepted from API bodies.
- Every organization owned query includes organization scope.
- Publication locks the assessment row and snapshots metadata, ordered scenarios, competencies, rubric criteria, mappings, and resource metadata in one transaction.
- Published content has no update API and PostgreSQL triggers reject updates or deletes.
- Assignments always reference the exact published version used for the invitation.
- Invitation tokens are random, stored as SHA-256 hashes, expire, and are rotated after acceptance.
- Magic-link tokens are hashed, short-lived, and can only be sent when paired with a matching pending invitation.
- PDF uploads validate both MIME type and the PDF file signature and are stored outside the public web root.
- Attempt numbers are allocated while holding an assignment row lock, so the configured limit remains safe under concurrent starts.
- Resource retrieval includes organization, assessment, and exact published version scope.
- Employee tokens can publish audio; admin observer tokens are hidden and cannot publish media or data.
- LiveKit webhook signatures are verified before lifecycle or recording state changes.
- One unique evaluation exists per attempt; claims use row locks and stale-claim recovery, and scores/evidence are committed atomically.
- Evaluation routes are admin-only and organization-scoped. Employee APIs never return rubrics, scores, evidence, or evaluator state.
- Provider secrets, invitation tokens, cookies, and authorization headers are redacted from logs.
