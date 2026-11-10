import { describe, expect, it } from 'vitest'
import { compactLintOutput } from '../oxlint/compact-output'
import { collectRuleCatalogueViolations } from '../standards/rule-catalogue'
import { lintRuleIds } from '../support/rule-catalogue'

const GATE_CHECKS = new Set(['tsconfig'])

function catalogue(rules: Record<string, unknown>) {
  return JSON.stringify({ rules }, null, 2)
}

function files(entries: Record<string, string>) {
  return new Map(Object.entries(entries))
}

describe('rule catalogue standard', () => {
  const rules = catalogue({
    'TS-01': { rule: 'Stay strict.', by: ['gate:tsconfig'] },
    'TS-02': { rule: 'No casts.', by: ['typescript/consistent-type-assertions'] },
  })

  it('accepts a catalogue whose IDs are all cited in the standards', () => {
    const violations = collectRuleCatalogueViolations(
      files({
        '.agents/rules.json': rules,
        '.agents/standards.md': 'Strict. [TS-01]\nNo casts. [TS-02]',
      }),
      GATE_CHECKS,
    )
    expect(violations).toEqual([])
  })

  it('reports undocumented, unknown and duplicate IDs', () => {
    const duplicated = rules.replace('"TS-02"', '"TS-01"')
    const violations = collectRuleCatalogueViolations(
      files({
        '.agents/rules.json': duplicated,
        '.agents/standards.md': 'Nothing cited.',
        'scripts/agent-gate/x.ts': "const line = 'oops [TS-99]'",
      }),
      GATE_CHECKS,
    )
    expect(violations.map((violation) => violation.detail)).toEqual(['TS-01', 'TS-01', 'TS-99'])
  })

  it('rejects unknown gate checks and lint plugin rules no rule names', () => {
    const violations = collectRuleCatalogueViolations(
      files({
        '.agents/rules.json': catalogue({ 'TS-01': { rule: 'Stay strict.', by: ['gate:nope'] } }),
        '.agents/standards.md': '[TS-01]',
        'scripts/oxlint/openwaggle-plugin.ts':
          "  rules: {\n    'no-for-each': noForEachRule,\n  },",
      }),
      GATE_CHECKS,
    )
    expect(violations.map((violation) => violation.detail)).toEqual([
      'TS-01: gate:nope',
      'openwaggle/no-for-each',
    ])
  })
})

describe('lint output rule IDs', () => {
  const ids = lintRuleIds([
    {
      id: 'TS-05',
      rule: 'No any.',
      by: ['typescript/no-explicit-any', 'gate:lint'],
      retired: false,
    },
  ])

  it('cites the catalogue ID after the lint rule name', () => {
    const output = 'src/a.ts:2:17: Unexpected `any`. [Error/typescript(no-explicit-any)]\n1 problem'
    expect(compactLintOutput(output, ids)).toEqual([
      'src/a.ts:2:17 typescript/no-explicit-any [TS-05] Unexpected `any`.',
    ])
  })

  it('leaves rules without an ID as they are', () => {
    expect(compactLintOutput('src/a.ts:1:1: Empty. [Error/eslint(no-empty)]', ids)).toEqual([
      'src/a.ts:1:1 no-empty Empty.',
    ])
  })
})
