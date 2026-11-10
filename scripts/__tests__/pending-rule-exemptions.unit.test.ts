import { describe, expect, it } from 'vitest'
import { collectPendingRuleExemptionViolations } from '../standards/pending-rule-exemptions'

const FIRST_FILE = 'src/main/first.ts'
const SECOND_FILE = 'src/renderer/src/Second.tsx'
const REPOSITORY_FILES = new Set([FIRST_FILE, SECOND_FILE])

function messages(exemptions: Parameters<typeof collectPendingRuleExemptionViolations>[1]) {
  return collectPendingRuleExemptionViolations(REPOSITORY_FILES, exemptions).map(
    (violation) => violation.message,
  )
}

describe('pending lint rule exemptions', () => {
  it('accepts sorted rules and files with positive counts', () => {
    expect(
      messages({
        curly: { [FIRST_FILE]: 2, [SECOND_FILE]: 1 },
        'typescript/array-type': { [FIRST_FILE]: 1 },
      }),
    ).toEqual([])
  })

  it('rejects unsorted rules and files', () => {
    expect(
      messages({
        'typescript/array-type': { [SECOND_FILE]: 1, [FIRST_FILE]: 1 },
        curly: { [FIRST_FILE]: 1 },
      }),
    ).toEqual(['Pending lint rules must be sorted.', 'Pending lint rule files must be sorted.'])
  })

  it('rejects missing files, paths outside src and counts that are not positive integers', () => {
    expect(
      messages({
        curly: { 'scripts/lint.ts': 1, [FIRST_FILE]: 0, 'src/main/gone.ts': 1 },
        'typescript/array-type': {},
      }),
    ).toEqual([
      'Pending lint rule files must be repository-relative src TS/TSX paths.',
      'Pending lint rule finding counts must be positive integers.',
      'Remove the pending lint rule entry of a missing file.',
      'Remove a pending lint rule with no files left.',
    ])
  })
})
