import { describe, expect, it } from 'vitest'
import { collectRendererDesignTokenExemptionViolations } from '../standards/renderer-design-token-exemptions'

const FIRST_FILE = 'src/renderer/src/features/chat/First.tsx'
const SECOND_FILE = 'src/renderer/src/features/chat/Second.ts'
const REPOSITORY_FILES = new Set([FIRST_FILE, SECOND_FILE])

describe('renderer design-token exemption manifest', () => {
  it('accepts sorted, unique, existing renderer source files', () => {
    expect(
      collectRendererDesignTokenExemptionViolations(REPOSITORY_FILES, [FIRST_FILE, SECOND_FILE]),
    ).toEqual([])
  })

  it('rejects duplicate and unsorted entries', () => {
    const violations = collectRendererDesignTokenExemptionViolations(REPOSITORY_FILES, [
      SECOND_FILE,
      FIRST_FILE,
      FIRST_FILE,
    ])

    expect(violations.map((violation) => violation.message)).toEqual(
      expect.arrayContaining([
        'Renderer design-token exemptions must be unique.',
        'Renderer design-token exemptions must be sorted.',
      ]),
    )
  })

  it('rejects missing and out-of-scope paths', () => {
    const violations = collectRendererDesignTokenExemptionViolations(REPOSITORY_FILES, [
      '/absolute.tsx',
      'scripts/example.ts',
      'src/renderer/src/features/chat/Missing.tsx',
      'src\\renderer\\src\\Example.tsx',
    ])

    expect(violations).toHaveLength(4)
    expect(violations.map((violation) => violation.message)).toContain(
      'Remove missing renderer design-token exemption.',
    )
  })

  it('rejects files ignored by the renderer ESLint configuration', () => {
    const ignoredFile = 'src/renderer/src/routeTree.gen.ts'
    const violations = collectRendererDesignTokenExemptionViolations(
      new Set([ignoredFile]),
      [ignoredFile],
    )

    expect(violations).toHaveLength(1)
    expect(violations.at(0)?.message).toContain('ESLint-ignored')
  })
})
