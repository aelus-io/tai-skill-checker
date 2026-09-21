import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import {
  assessmentVersions,
  assessments,
  competencies,
  resources,
  resourceChunks,
  rubrics,
  scenarioCompetencies,
  scenarios,
} from '../../../db/schema.js'
import { ConflictError, NotFoundError } from '../../../http/errors.js'
import type { GeneratedAssessmentContent, RubricCriteria } from '../types/index.js'
import { validateDraftForPublication } from './publication.js'

type Scope = { organizationId: string; userId: string }

export function createAssessmentService(db: Database) {
  async function requireAssessment(organizationId: string, assessmentId: string) {
    const [assessment] = await db.select().from(assessments).where(and(
      eq(assessments.id, assessmentId),
      eq(assessments.organizationId, organizationId),
    )).limit(1)
    if (!assessment) throw new NotFoundError('Assessment')
    return assessment
  }

  async function create(input: Scope & { name: string; description: string; preparationInstructions: string }) {
    const [assessment] = await db.insert(assessments).values({
      organizationId: input.organizationId,
      createdBy: input.userId,
      name: input.name,
      description: input.description,
      preparationInstructions: input.preparationInstructions,
    }).returning()
    if (!assessment) throw new Error('Assessment insert did not return a row')
    return assessment
  }

  async function update(input: Scope & { assessmentId: string; name: string; description: string; preparationInstructions: string }) {
    const [assessment] = await db.update(assessments).set({
      name: input.name,
      description: input.description,
      preparationInstructions: input.preparationInstructions,
      updatedAt: new Date(),
    }).where(and(
      eq(assessments.id, input.assessmentId),
      eq(assessments.organizationId, input.organizationId),
      inArray(assessments.status, ['DRAFT', 'PUBLISHED']),
    )).returning()
    if (!assessment) throw new NotFoundError('Editable assessment')
    return assessment
  }

  async function list(organizationId: string) {
    return db.select().from(assessments)
      .where(eq(assessments.organizationId, organizationId))
      .orderBy(asc(assessments.createdAt))
  }

  async function get(organizationId: string, assessmentId: string) {
    const assessment = await requireAssessment(organizationId, assessmentId)
    const [draftScenarios, draftCompetencies, draftRubrics, mappings, attachedResources, versions] = await Promise.all([
      db.select().from(scenarios).where(and(eq(scenarios.organizationId, organizationId), eq(scenarios.assessmentId, assessmentId), isNull(scenarios.assessmentVersionId))).orderBy(asc(scenarios.position)),
      db.select().from(competencies).where(and(eq(competencies.organizationId, organizationId), eq(competencies.assessmentId, assessmentId), isNull(competencies.assessmentVersionId))).orderBy(asc(competencies.position)),
      db.select().from(rubrics).where(and(eq(rubrics.organizationId, organizationId), eq(rubrics.assessmentId, assessmentId), isNull(rubrics.assessmentVersionId))),
      db.select().from(scenarioCompetencies).where(and(eq(scenarioCompetencies.organizationId, organizationId), eq(scenarioCompetencies.assessmentId, assessmentId), isNull(scenarioCompetencies.assessmentVersionId))),
      db.select({ id: resources.id, filename: resources.filename, mimeType: resources.mimeType, byteSize: resources.byteSize, status: resources.status, createdAt: resources.createdAt }).from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.assessmentId, assessmentId), isNull(resources.assessmentVersionId))),
      db.select().from(assessmentVersions).where(and(eq(assessmentVersions.organizationId, organizationId), eq(assessmentVersions.assessmentId, assessmentId))).orderBy(asc(assessmentVersions.versionNumber)),
    ])
    return { ...assessment, scenarios: draftScenarios, competencies: draftCompetencies, rubrics: draftRubrics, scenarioCompetencies: mappings, resources: attachedResources, versions }
  }

  async function getVersion(organizationId: string, assessmentId: string, versionId: string) {
    const [version] = await db.select().from(assessmentVersions).where(and(
      eq(assessmentVersions.id, versionId), eq(assessmentVersions.assessmentId, assessmentId), eq(assessmentVersions.organizationId, organizationId),
    )).limit(1)
    if (!version) throw new NotFoundError('Assessment version')
    const [versionScenarios, versionCompetencies, versionRubrics, mappings, versionResources] = await Promise.all([
      db.select().from(scenarios).where(and(eq(scenarios.organizationId, organizationId), eq(scenarios.assessmentVersionId, versionId))).orderBy(asc(scenarios.position)),
      db.select().from(competencies).where(and(eq(competencies.organizationId, organizationId), eq(competencies.assessmentVersionId, versionId))).orderBy(asc(competencies.position)),
      db.select().from(rubrics).where(and(eq(rubrics.organizationId, organizationId), eq(rubrics.assessmentVersionId, versionId))),
      db.select().from(scenarioCompetencies).where(and(eq(scenarioCompetencies.organizationId, organizationId), eq(scenarioCompetencies.assessmentVersionId, versionId))),
      db.select({ id: resources.id, filename: resources.filename, mimeType: resources.mimeType, byteSize: resources.byteSize, status: resources.status, createdAt: resources.createdAt }).from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.assessmentVersionId, versionId))),
    ])
    return { ...version, scenarios: versionScenarios, competencies: versionCompetencies, rubrics: versionRubrics, scenarioCompetencies: mappings, resources: versionResources }
  }

  async function addScenario(input: Scope & { assessmentId: string; title: string; prompt: string; followUpGuidance: string; position: number }) {
    await requireAssessment(input.organizationId, input.assessmentId)
    const [scenario] = await db.insert(scenarios).values({
      organizationId: input.organizationId,
      assessmentId: input.assessmentId,
      title: input.title,
      prompt: input.prompt,
      followUpGuidance: input.followUpGuidance,
      position: input.position,
    }).returning()
    return scenario
  }

  async function updateScenario(input: Scope & { assessmentId: string; scenarioId: string; title: string; prompt: string; followUpGuidance: string; position: number }) {
    const [scenario] = await db.update(scenarios).set({
      title: input.title, prompt: input.prompt, followUpGuidance: input.followUpGuidance, position: input.position, updatedAt: new Date(),
    }).where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.organizationId, input.organizationId), eq(scenarios.assessmentId, input.assessmentId), isNull(scenarios.assessmentVersionId))).returning()
    if (!scenario) throw new NotFoundError('Draft scenario')
    return scenario
  }

  async function addCompetency(input: Scope & { assessmentId: string; name: string; description: string; position: number }) {
    await requireAssessment(input.organizationId, input.assessmentId)
    const [competency] = await db.insert(competencies).values({
      organizationId: input.organizationId, assessmentId: input.assessmentId, name: input.name, description: input.description, position: input.position,
    }).returning()
    return competency
  }

  async function updateCompetency(input: Scope & { assessmentId: string; competencyId: string; name: string; description: string; position: number }) {
    const [competency] = await db.update(competencies).set({ name: input.name, description: input.description, position: input.position, updatedAt: new Date() }).where(and(
      eq(competencies.id, input.competencyId), eq(competencies.organizationId, input.organizationId), eq(competencies.assessmentId, input.assessmentId), isNull(competencies.assessmentVersionId),
    )).returning()
    if (!competency) throw new NotFoundError('Draft competency')
    return competency
  }

  async function addRubric(input: Scope & { assessmentId: string; competencyId: string; title: string; criteria: RubricCriteria; expectedBehaviors: string[] }) {
    const [competency] = await db.select({ id: competencies.id }).from(competencies).where(and(
      eq(competencies.id, input.competencyId), eq(competencies.organizationId, input.organizationId), eq(competencies.assessmentId, input.assessmentId), isNull(competencies.assessmentVersionId),
    )).limit(1)
    if (!competency) throw new NotFoundError('Draft competency')
    const [rubric] = await db.insert(rubrics).values({
      organizationId: input.organizationId, assessmentId: input.assessmentId, competencyId: input.competencyId,
      title: input.title, criteria: input.criteria, expectedBehaviors: input.expectedBehaviors,
    }).returning()
    return rubric
  }

  async function updateRubric(input: Scope & { assessmentId: string; rubricId: string; title: string; criteria: RubricCriteria; expectedBehaviors: string[] }) {
    const [rubric] = await db.update(rubrics).set({ title: input.title, criteria: input.criteria, expectedBehaviors: input.expectedBehaviors, updatedAt: new Date() }).where(and(
      eq(rubrics.id, input.rubricId), eq(rubrics.organizationId, input.organizationId), eq(rubrics.assessmentId, input.assessmentId), isNull(rubrics.assessmentVersionId),
    )).returning()
    if (!rubric) throw new NotFoundError('Draft rubric')
    return rubric
  }

  async function mapScenarioCompetency(input: Scope & { assessmentId: string; scenarioId: string; competencyId: string }) {
    const [scenario, competency] = await Promise.all([
      db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.organizationId, input.organizationId), eq(scenarios.assessmentId, input.assessmentId), isNull(scenarios.assessmentVersionId))).limit(1),
      db.select({ id: competencies.id }).from(competencies).where(and(eq(competencies.id, input.competencyId), eq(competencies.organizationId, input.organizationId), eq(competencies.assessmentId, input.assessmentId), isNull(competencies.assessmentVersionId))).limit(1),
    ])
    if (!scenario[0] || !competency[0]) throw new NotFoundError('Draft scenario or competency')
    const [mapping] = await db.insert(scenarioCompetencies).values({
      organizationId: input.organizationId, assessmentId: input.assessmentId, scenarioId: input.scenarioId, competencyId: input.competencyId,
    }).onConflictDoNothing().returning()
    return mapping ?? { scenarioId: input.scenarioId, competencyId: input.competencyId }
  }

  async function replaceDraftContent(input: Scope & { assessmentId: string; content: GeneratedAssessmentContent }) {
    await requireAssessment(input.organizationId, input.assessmentId)
    return db.transaction(async (tx) => {
      const oldCompetencies = await tx.select({ id: competencies.id }).from(competencies).where(and(eq(competencies.assessmentId, input.assessmentId), eq(competencies.organizationId, input.organizationId), isNull(competencies.assessmentVersionId)))
      const oldScenarios = await tx.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.assessmentId, input.assessmentId), eq(scenarios.organizationId, input.organizationId), isNull(scenarios.assessmentVersionId)))
      if (oldScenarios.length) await tx.delete(scenarioCompetencies).where(inArray(scenarioCompetencies.scenarioId, oldScenarios.map((row) => row.id)))
      if (oldCompetencies.length) await tx.delete(rubrics).where(inArray(rubrics.competencyId, oldCompetencies.map((row) => row.id)))
      await tx.delete(scenarios).where(and(eq(scenarios.assessmentId, input.assessmentId), eq(scenarios.organizationId, input.organizationId), isNull(scenarios.assessmentVersionId)))
      await tx.delete(competencies).where(and(eq(competencies.assessmentId, input.assessmentId), eq(competencies.organizationId, input.organizationId), isNull(competencies.assessmentVersionId)))

      const createdCompetencies = await tx.insert(competencies).values(input.content.competencies.map((item, index) => ({
        organizationId: input.organizationId, assessmentId: input.assessmentId, name: item.name, description: item.description, position: index + 1,
      }))).returning()
      const byName = new Map(createdCompetencies.map((item) => [item.name.toLocaleLowerCase(), item]))
      const createdScenarios = await tx.insert(scenarios).values(input.content.scenarios.map((item, index) => ({
        organizationId: input.organizationId, assessmentId: input.assessmentId, title: item.title, prompt: item.prompt, followUpGuidance: item.followUpGuidance, position: index + 1,
      }))).returning()
      await tx.insert(rubrics).values(input.content.rubrics.map((item) => {
        const competency = byName.get(item.competencyName.toLocaleLowerCase())
        if (!competency) throw new ConflictError('INVALID_GENERATED_CONTENT', `Unknown rubric competency: ${item.competencyName}`)
        return { organizationId: input.organizationId, assessmentId: input.assessmentId, competencyId: competency.id, title: item.title, criteria: item.criteria, expectedBehaviors: item.expectedBehaviors }
      }))
      const mappings = input.content.scenarios.flatMap((item, scenarioIndex) => item.competencyNames.map((name) => {
        const competency = byName.get(name.toLocaleLowerCase())
        if (!competency) throw new ConflictError('INVALID_GENERATED_CONTENT', `Unknown scenario competency: ${name}`)
        const scenario = createdScenarios[scenarioIndex]
        if (!scenario) throw new Error('Generated scenario insert mismatch')
        return { organizationId: input.organizationId, assessmentId: input.assessmentId, scenarioId: scenario.id, competencyId: competency.id }
      }))
      if (mappings.length) await tx.insert(scenarioCompetencies).values(mappings)
      return { scenarios: createdScenarios.length, competencies: createdCompetencies.length, rubrics: input.content.rubrics.length }
    })
  }

  async function publish(input: Scope & { assessmentId: string }) {
    return db.transaction(async (tx) => {
      const [assessment] = await tx.select().from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).for('update').limit(1)
      if (!assessment) throw new NotFoundError('Assessment')
      if (assessment.status === 'ARCHIVED') throw new ConflictError('ASSESSMENT_ARCHIVED', 'Archived assessments cannot be published')

      const [draftScenarios, draftCompetencies, draftRubrics, draftMappings, draftResources] = await Promise.all([
        tx.select().from(scenarios).where(and(eq(scenarios.assessmentId, assessment.id), eq(scenarios.organizationId, input.organizationId), isNull(scenarios.assessmentVersionId))).orderBy(asc(scenarios.position)),
        tx.select().from(competencies).where(and(eq(competencies.assessmentId, assessment.id), eq(competencies.organizationId, input.organizationId), isNull(competencies.assessmentVersionId))).orderBy(asc(competencies.position)),
        tx.select().from(rubrics).where(and(eq(rubrics.assessmentId, assessment.id), eq(rubrics.organizationId, input.organizationId), isNull(rubrics.assessmentVersionId))),
        tx.select().from(scenarioCompetencies).where(and(eq(scenarioCompetencies.assessmentId, assessment.id), eq(scenarioCompetencies.organizationId, input.organizationId), isNull(scenarioCompetencies.assessmentVersionId))),
        tx.select().from(resources).where(and(eq(resources.assessmentId, assessment.id), eq(resources.organizationId, input.organizationId), isNull(resources.assessmentVersionId))),
      ])
      validateDraftForPublication({ scenarios: draftScenarios, competencies: draftCompetencies, rubrics: draftRubrics, mappings: draftMappings })
      if (draftResources.some((resource) => resource.status !== 'READY')) throw new ConflictError('RESOURCES_NOT_READY', 'Process every uploaded resource before publishing')

      const versionNumber = assessment.latestVersionNumber + 1
      const [version] = await tx.insert(assessmentVersions).values({
        organizationId: input.organizationId, assessmentId: assessment.id, versionNumber,
        name: assessment.name, description: assessment.description, preparationInstructions: assessment.preparationInstructions, publishedBy: input.userId,
      }).returning()
      if (!version) throw new Error('Assessment version insert did not return a row')

      const publishedCompetencies = await tx.insert(competencies).values(draftCompetencies.map((item) => ({
        organizationId: input.organizationId, assessmentId: assessment.id, assessmentVersionId: version.id, name: item.name, description: item.description, position: item.position,
      }))).returning()
      const competencyIds = new Map(draftCompetencies.map((item, index) => [item.id, publishedCompetencies[index]?.id]))
      const publishedScenarios = await tx.insert(scenarios).values(draftScenarios.map((item) => ({
        organizationId: input.organizationId, assessmentId: assessment.id, assessmentVersionId: version.id, title: item.title, prompt: item.prompt, followUpGuidance: item.followUpGuidance, position: item.position,
      }))).returning()
      const scenarioIds = new Map(draftScenarios.map((item, index) => [item.id, publishedScenarios[index]?.id]))
      await tx.insert(rubrics).values(draftRubrics.map((item) => {
        const competencyId = competencyIds.get(item.competencyId)
        if (!competencyId) throw new Error('Could not map published competency')
        return { organizationId: input.organizationId, assessmentId: assessment.id, assessmentVersionId: version.id, competencyId, title: item.title, criteria: item.criteria, expectedBehaviors: item.expectedBehaviors }
      }))
      await tx.insert(scenarioCompetencies).values(draftMappings.map((item) => {
        const scenarioId = scenarioIds.get(item.scenarioId)
        const competencyId = competencyIds.get(item.competencyId)
        if (!scenarioId || !competencyId) throw new Error('Could not map published scenario competency')
        return { organizationId: input.organizationId, assessmentId: assessment.id, assessmentVersionId: version.id, scenarioId, competencyId }
      }))
      if (draftResources.length) {
        const publishedResources = await tx.insert(resources).values(draftResources.map((item) => ({
        organizationId: input.organizationId,
        assessmentId: assessment.id,
        assessmentVersionId: version.id,
        filename: item.filename,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        storageKey: item.storageKey,
        status: item.status,
        uploadedBy: item.uploadedBy,
        }))).returning()
        const draftChunks = await tx.select().from(resourceChunks).where(inArray(resourceChunks.resourceId, draftResources.map((item) => item.id)))
        const publishedResourceIds = new Map(draftResources.map((item, index) => [item.id, publishedResources[index]?.id]))
        if (draftChunks.length) await tx.insert(resourceChunks).values(draftChunks.map((chunk) => {
          const resourceId = publishedResourceIds.get(chunk.resourceId)
          if (!resourceId) throw new Error('Could not map published resource chunk')
          return { organizationId: input.organizationId, assessmentId: assessment.id, assessmentVersionId: version.id, resourceId, position: chunk.position, content: chunk.content, embedding: chunk.embedding }
        }))
      }
      await tx.update(assessments).set({ status: 'PUBLISHED', latestVersionNumber: versionNumber, currentPublishedVersionId: version.id, updatedAt: new Date() }).where(eq(assessments.id, assessment.id))
      return version
    })
  }

  return { create, update, list, get, getVersion, addScenario, updateScenario, addCompetency, updateCompetency, addRubric, updateRubric, mapScenarioCompetency, replaceDraftContent, publish, requireAssessment }
}

export type AssessmentService = ReturnType<typeof createAssessmentService>
