import { ConflictError } from '../../../http/errors.js'

export function validateDraftForPublication(input: {
  scenarios: Array<{ id: string }>
  competencies: Array<{ id: string }>
  rubrics: Array<{ competencyId: string }>
  mappings: Array<{ scenarioId: string; competencyId: string }>
}) {
  if (!input.scenarios.length || !input.competencies.length || !input.rubrics.length) {
    throw new ConflictError('INCOMPLETE_ASSESSMENT', 'At least one scenario, competency, and rubric are required')
  }
  const competencyIds = new Set(input.competencies.map((item) => item.id))
  const rubricCompetencies = new Set(input.rubrics.map((item) => item.competencyId))
  const mappedScenarios = new Set(input.mappings.filter((item) => competencyIds.has(item.competencyId)).map((item) => item.scenarioId))
  if (input.competencies.some((item) => !rubricCompetencies.has(item.id)) || input.scenarios.some((item) => !mappedScenarios.has(item.id))) {
    throw new ConflictError('INCOMPLETE_ASSESSMENT', 'Every competency needs a rubric and every scenario needs a competency mapping')
  }
}
