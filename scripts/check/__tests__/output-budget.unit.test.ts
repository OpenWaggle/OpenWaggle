import { describe, expect, it } from 'vitest'
import { renderJobSummary } from '../job-summary'
import { budgetVerdict } from '../output-budget'

describe('budgetVerdict', () => {
  it('fails a green run over its budget', () => {
    expect(budgetVerdict('check', 31, 20, true)).toEqual({
      ok: false,
      message:
        "output-budget: green check printed 31 o200k tokens, over its budget of 20. Keep green output to the runner's one summary line.",
    })
  })

  it('passes within budget and says when the budget can be lowered', () => {
    expect(budgetVerdict('check', 13, 20, true).message).toBe(
      'output-budget: check 13/20 o200k tokens',
    )
    expect(budgetVerdict('check', 5, 20, true).message).toBe(
      'output-budget: check 5/20 o200k tokens; lower the budget to 13',
    )
  })

  it('leaves a failed gate to its own exit code, and requires a budget for each gate', () => {
    expect(budgetVerdict('verify', 400, 20, false).ok).toBe(true)
    expect(budgetVerdict('lint', 10, undefined, true).ok).toBe(false)
  })
})

describe('renderJobSummary', () => {
  it('lists the steps, slowest first, with the run and token totals', () => {
    const report = {
      gate: 'check',
      ok: true,
      durationMs: 41_200,
      concurrency: 2,
      cores: 4,
      loadAverage: [1.5, 1, 0.5],
      steps: [
        { id: 'format', status: 'passed', startMs: 100, durationMs: 2_000 },
        { id: 'lint', status: 'passed', startMs: 3_000, durationMs: 12_000 },
      ],
    }
    expect(renderJobSummary(report, { tokens: 13, budget: 20 })).toBe(
      [
        '### check: passed in 41.2s',
        '',
        'Concurrency 2 on 4 cores, load 1.50 1.00 0.50. Output: 13 o200k tokens (budget 20).',
        '',
        '| Step | Status | Starts at | Duration |',
        '| --- | --- | ---: | ---: |',
        '| lint | passed | 3.0s | 12.0s |',
        '| format | passed | 0.1s | 2.0s |',
        '',
      ].join('\n'),
    )
  })

  it('says so when the runner wrote no report', () => {
    expect(renderJobSummary(undefined, undefined)).toContain('the runner did not start')
  })
})
