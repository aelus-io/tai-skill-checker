import { describe, expect, it } from 'vitest'
import { validateDraftForPublication } from '../index.js'

describe('assessment publication validation', () => {
  it('accepts a fully mapped and rubric-scored draft', () => {
    expect(() => validateDraftForPublication({
      scenarios: [{ id: 'scenario-1' }],
      competencies: [{ id: 'competency-1' }],
      rubrics: [{ competencyId: 'competency-1' }],
      mappings: [{ scenarioId: 'scenario-1', competencyId: 'competency-1' }],
    })).not.toThrow()
  })

  it('rejects a scenario without a valid competency mapping', () => {
    expect(() => validateDraftForPublication({
      scenarios: [{ id: 'scenario-1' }],
      competencies: [{ id: 'competency-1' }],
      rubrics: [{ competencyId: 'competency-1' }],
      mappings: [{ scenarioId: 'scenario-1', competencyId: 'another-assessment-competency' }],
    })).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_ASSESSMENT' }))
  })

  it('rejects a competency without a rubric', () => {
    expect(() => validateDraftForPublication({
      scenarios: [{ id: 'scenario-1' }],
      competencies: [{ id: 'competency-1' }, { id: 'competency-2' }],
      rubrics: [{ competencyId: 'competency-1' }],
      mappings: [{ scenarioId: 'scenario-1', competencyId: 'competency-1' }],
    })).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_ASSESSMENT' }))
  })
})
