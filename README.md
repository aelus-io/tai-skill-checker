# TAI Skill Checker Backend

Phase 1 backend for creating, publishing, and assigning AI skill assessments.

## Stack

- Node.js 22+, Express 5, strict TypeScript
- Neon PostgreSQL, Drizzle ORM, pgvector
- Better Auth with email and password
- Gemini structured generation
- Resend invitation delivery
- Pino logging, Zod validation, Vitest

## Setup

1. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `FRONTEND_URL`. Add the Gemini key for generation and the Resend key and sender for invitations.
2. Install dependencies and migrate a clean Neon database:

   ```sh
   npm install
   npm run db:migrate
   ```

   The initial migration enables the Neon `vector` extension. Published assessment rows are protected by database triggers as well as the API.

3. Start and verify the API:

   ```sh
   npm run dev
   npm run typecheck
   npm test
   npm run build
   ```

## First admin

Create the first user with `POST /api/auth/sign-up/email`:

```json
{
  "name": "Admin",
  "email": "admin@example.com",
  "password": "a-secure-password"
}
```

With the returned session cookie, call `POST /api/bootstrap` once:

```json
{
  "organizationName": "Example Company",
  "slug": "example-company"
}
```

Only the first authenticated user can bootstrap the single prototype organization. Later users enter through invitations.

## API flow

All admin endpoints require a Better Auth session cookie and an `ADMIN` organization membership.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Database backed health check |
| `POST` | `/api/bootstrap` | Create the one organization and first admin membership |
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
| `GET` | `/api/invitations/:token` | Read employee safe invitation preview |
| `POST` | `/api/invitations/:token/accept` | Bind the assignment to the matching signed in employee |

Generation accepts a `brief` and optional `sourceText`. It returns and persists editable scenarios, competencies, mappings, and rubrics. Publication requires every scenario to have a valid competency mapping and every competency to have a rubric.

Invitation recipients follow the emailed link, create or sign into a Better Auth account with the invited email, then accept the invitation. Acceptance consumes the invitation secret, creates the employee membership, and binds the assignment to that user. Preview responses expose competencies but omit scenarios and rubrics.

## Domain guarantees

- `organizationId` is derived from the authenticated membership and never accepted from API bodies.
- Every organization owned query includes organization scope.
- Publication locks the assessment row and snapshots metadata, ordered scenarios, competencies, rubric criteria, mappings, and resource metadata in one transaction.
- Published content has no update API and PostgreSQL triggers reject updates or deletes.
- Assignments always reference the exact published version used for the invitation.
- Invitation tokens are random, stored as SHA-256 hashes, expire, and are rotated after acceptance.
- PDF uploads validate both MIME type and the PDF file signature and are stored outside the public web root.
- Provider secrets, invitation tokens, cookies, and authorization headers are redacted from logs.
