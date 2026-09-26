import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const roleEnum = pgEnum('role', ['ADMIN', 'EMPLOYEE'])
export const assessmentStatusEnum = pgEnum('assessment_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED'])
export const invitationStatusEnum = pgEnum('invitation_status', ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'])
export const assignmentStatusEnum = pgEnum('assignment_status', ['PENDING', 'READY', 'COMPLETED', 'EXPIRED'])
export const attemptStatusEnum = pgEnum('attempt_status', ['READY', 'IN_PROGRESS', 'PROCESSING', 'COMPLETED', 'ABANDONED', 'FAILED', 'EXPIRED'])
export const attemptSpeakerEnum = pgEnum('attempt_speaker', ['EMPLOYEE', 'AGENT', 'SYSTEM'])
export const resourceStatusEnum = pgEnum('resource_status', ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'])
export const evaluationStatusEnum = pgEnum('evaluation_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
export const recordingStatusEnum = pgEnum('recording_status', ['STARTING', 'ACTIVE', 'COMPLETED', 'FAILED'])

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('organizations_slug_uidx').on(table.slug)])

// Better Auth owns these four tables. Domain roles live in organization_memberships.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('users_email_uidx').on(table.email)])

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [uniqueIndex('sessions_token_uidx').on(table.token), index('sessions_user_idx').on(table.userId)])

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('accounts_provider_account_uidx').on(table.providerId, table.accountId), index('accounts_user_idx').on(table.userId)])

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('verifications_identifier_idx').on(table.identifier)])

export const organizationMemberships = pgTable('organization_memberships', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('organization_memberships_org_user_uidx').on(table.organizationId, table.userId),
  index('organization_memberships_user_idx').on(table.userId),
])

export const organizationAgentSettings = pgTable('organization_agent_settings', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  systemPrompt: text('system_prompt').notNull(),
  welcomeMessage: text('welcome_message').notNull(),
  closingMessage: text('closing_message').notNull(),
  voice: text('voice').notNull(),
  temperature: real('temperature').notNull(),
  topP: real('top_p').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('organization_agent_settings_org_uidx').on(table.organizationId)])

export const assessments = pgTable('assessments', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  preparationInstructions: text('preparation_instructions').notNull().default(''),
  coverImageKey: text('cover_image_key'),
  status: assessmentStatusEnum('status').notNull().default('DRAFT'),
  latestVersionNumber: integer('latest_version_number').notNull().default(0),
  currentPublishedVersionId: uuid('current_published_version_id').references((): AnyPgColumn => assessmentVersions.id, { onDelete: 'set null' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('assessments_org_idx').on(table.organizationId)])

export const assessmentVersions = pgTable('assessment_versions', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(),
  // Publication-time audit snapshot. Current display names come from assessments.name.
  name: text('name').notNull(),
  description: text('description').notNull(),
  preparationInstructions: text('preparation_instructions').notNull(),
  publishedBy: text('published_by').notNull().references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('assessment_versions_assessment_number_uidx').on(table.assessmentId, table.versionNumber),
  index('assessment_versions_org_idx').on(table.organizationId),
])

export const scenarios = pgTable('scenarios', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  followUpGuidance: text('follow_up_guidance').notNull().default(''),
  position: integer('position').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('scenarios_draft_position_uidx').on(table.assessmentId, table.position).where(sql`${table.assessmentVersionId} is null`),
  uniqueIndex('scenarios_version_position_uidx').on(table.assessmentVersionId, table.position).where(sql`${table.assessmentVersionId} is not null`),
  index('scenarios_org_assessment_idx').on(table.organizationId, table.assessmentId),
  check('scenarios_positive_position', sql`${table.position} > 0`),
])

export const competencies = pgTable('competencies', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('competencies_draft_position_uidx').on(table.assessmentId, table.position).where(sql`${table.assessmentVersionId} is null`),
  uniqueIndex('competencies_version_position_uidx').on(table.assessmentVersionId, table.position).where(sql`${table.assessmentVersionId} is not null`),
  index('competencies_org_assessment_idx').on(table.organizationId, table.assessmentId),
  check('competencies_positive_position', sql`${table.position} > 0`),
])

export const rubrics = pgTable('rubrics', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  competencyId: uuid('competency_id').notNull().references(() => competencies.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  criteria: jsonb('criteria').$type<Array<{ score: number; description: string }>>().notNull(),
  expectedBehaviors: text('expected_behaviors').array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('rubrics_org_assessment_idx').on(table.organizationId, table.assessmentId)])

export const scenarioCompetencies = pgTable('scenario_competencies', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  scenarioId: uuid('scenario_id').notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
  competencyId: uuid('competency_id').notNull().references(() => competencies.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('scenario_competencies_pair_uidx').on(table.scenarioId, table.competencyId),
  index('scenario_competencies_org_assessment_idx').on(table.organizationId, table.assessmentId),
])

export const resources = pgTable('resources', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  storageKey: text('storage_key').notNull(),
  status: resourceStatusEnum('status').notNull().default('UPLOADED'),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('resources_org_assessment_idx').on(table.organizationId, table.assessmentId),
  index('resources_version_idx').on(table.assessmentVersionId),
])

export const resourceChunks = pgTable('resource_chunks', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, { onDelete: 'cascade' }),
  resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('resource_chunks_resource_position_uidx').on(table.resourceId, table.position),
  index('resource_chunks_scope_idx').on(table.organizationId, table.assessmentId),
  index('resource_chunks_version_idx').on(table.assessmentVersionId),
])

export const invitations = pgTable('invitations', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'restrict' }),
  assessmentVersionId: uuid('assessment_version_id').notNull().references(() => assessmentVersions.id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  status: invitationStatusEnum('status').notNull().default('PENDING'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
  emailError: text('email_error'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('invitations_token_hash_uidx').on(table.tokenHash),
  uniqueIndex('invitations_version_email_uidx').on(table.assessmentVersionId, table.email),
  index('invitations_org_assessment_idx').on(table.organizationId, table.assessmentId),
])

export const assignments = pgTable('assignments', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'restrict' }),
  assessmentVersionId: uuid('assessment_version_id').notNull().references(() => assessmentVersions.id, { onDelete: 'restrict' }),
  invitationId: uuid('invitation_id').notNull().references(() => invitations.id, { onDelete: 'restrict' }),
  employeeEmail: text('employee_email').notNull(),
  employeeUserId: text('employee_user_id').references(() => users.id),
  status: assignmentStatusEnum('status').notNull().default('PENDING'),
  attemptsResetAt: timestamp('attempts_reset_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('assignments_invitation_uidx').on(table.invitationId),
  index('assignments_org_employee_idx').on(table.organizationId, table.employeeUserId),
])

export const attempts = pgTable('attempts', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'restrict' }),
  assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'restrict' }),
  assessmentVersionId: uuid('assessment_version_id').notNull().references(() => assessmentVersions.id, { onDelete: 'restrict' }),
  employeeUserId: text('employee_user_id').notNull().references(() => users.id),
  status: attemptStatusEnum('status').notNull().default('READY'),
  attemptNumber: integer('attempt_number').notNull(),
  roomName: text('room_name'),
  currentScenarioId: uuid('current_scenario_id'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('attempts_assignment_number_uidx').on(table.assignmentId, table.attemptNumber),
  index('attempts_org_status_idx').on(table.organizationId, table.status),
])

export const attemptScenarios = pgTable('attempt_scenarios', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  scenarioId: uuid('scenario_id').notNull().references(() => scenarios.id, { onDelete: 'restrict' }),
  position: integer('position').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [uniqueIndex('attempt_scenarios_attempt_scenario_uidx').on(table.attemptId, table.scenarioId)])

export const attemptTurns = pgTable('attempt_turns', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'set null' }),
  speaker: attemptSpeakerEnum('speaker').notNull(),
  content: text('content').notNull(),
  sequence: integer('sequence').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('attempt_turns_attempt_sequence_uidx').on(table.attemptId, table.sequence)])

export const attemptEvents = pgTable('attempt_events', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text('idempotency_key'),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('attempt_events_attempt_key_uidx').on(table.attemptId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null`)])

export const recordings = pgTable('recordings', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'restrict' }),
  storageKey: text('storage_key').notNull(),
  egressId: text('egress_id').notNull(),
  status: recordingStatusEnum('status').notNull().default('STARTING'),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size'),
  durationSeconds: integer('duration_seconds'),
  errorMessage: text('error_message'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('recordings_attempt_uidx').on(table.attemptId), uniqueIndex('recordings_egress_uidx').on(table.egressId)])

export const evaluations = pgTable('evaluations', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'restrict' }),
  status: evaluationStatusEnum('status').notNull().default('PENDING'),
  overallScore: real('overall_score'),
  strengths: text('strengths').array(),
  gaps: text('gaps').array(),
  recommendations: text('recommendations').array(),
  errorMessage: text('error_message'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('evaluations_attempt_uidx').on(table.attemptId),
  index('evaluations_status_claimed_idx').on(table.status, table.claimedAt),
])

export const competencyScores = pgTable('competency_scores', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  evaluationId: uuid('evaluation_id').notNull().references(() => evaluations.id, { onDelete: 'cascade' }),
  competencyId: uuid('competency_id').notNull().references(() => competencies.id, { onDelete: 'restrict' }),
  score: integer('score').notNull(),
  maxScore: integer('max_score').notNull().default(5),
  reasoning: text('reasoning').notNull(),
}, (table) => [
  uniqueIndex('competency_scores_evaluation_competency_uidx').on(table.evaluationId, table.competencyId),
  check('competency_scores_range', sql`${table.score} between 1 and ${table.maxScore}`),
])

export const evaluationEvidence = pgTable('evaluation_evidence', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  competencyScoreId: uuid('competency_score_id').notNull().references(() => competencyScores.id, { onDelete: 'cascade' }),
  attemptTurnId: uuid('attempt_turn_id').notNull().references(() => attemptTurns.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
})

export type DatabaseSchema = typeof import('./schema.js')
