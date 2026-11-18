import { describe, expect, it } from 'vitest'
import { compactLintOutput } from '../compact-output'

describe('compactLintOutput', () => {
  it('prints one line per finding with the rule name the config uses', () => {
    const output = [
      'src/a.ts:2:17: Unexpected `any`. [Error/typescript(no-explicit-any)]',
      'src/a.ts:1:1: Empty. [Error/eslint(no-empty)]',
      'config error: no such plugin',
      '',
      '2 problems',
    ].join('\n')
    expect(compactLintOutput(output)).toEqual([
      'src/a.ts:2:17 typescript/no-explicit-any Unexpected `any`.',
      'src/a.ts:1:1 no-empty Empty.',
      'config error: no such plugin',
    ])
  })
})
