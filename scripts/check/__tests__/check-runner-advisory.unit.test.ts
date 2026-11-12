import { mkdir, rm } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { advisoryAnnotations, renderJobSummary } from '../job-summary'
import { advisoryFindings, advisoryOutput, CHECK_OUTPUT_DIRECTORY, logPath } from '../report'
import { executeSteps } from '../scheduler'
import type { CheckStep } from '../step-model'

const ID = `advisory-test-${process.pid}`

function step(id: string, extra: Partial<CheckStep> = {}): CheckStep {
  return {
    id,
    summary: id,
    commands: [['true']],
    inputs: [],
    findings: 'lines',
    hint: `about ${id}`,
    ...extra,
  }
}

afterAll(async () => {
  await Promise.all([ID, `${ID}-after`].map((id) => rm(logPath(id), { force: true })))
})

describe('an advisory step', () => {
  it('passes whatever it exits with, keeps its exit, and lets dependents run', async () => {
    await mkdir(CHECK_OUTPUT_DIRECTORY, { recursive: true })
    const advisory = step(ID, {
      advisory: true,
      commands: [
        [
          'sh',
          '-c',
          'echo "src/a.test.ts:1:1 coverage-uniqueness advisory: nothing unique"; exit 3',
        ],
      ],
    })
    const after = step(`${ID}-after`, { dependsOn: [ID] })

    const { reports } = await executeSteps(
      [
        { step: advisory, commands: advisory.commands },
        { step: after, commands: after.commands },
      ],
      { cache: false, concurrency: 2 },
      performance.now(),
    )
    const report = reports.get(ID)
    if (report === undefined) throw new Error('the advisory step did not run')
    const advisories = await advisoryFindings(report)

    expect([report.status, report.exitCode]).toEqual(['passed', 3])
    expect(reports.get(`${ID}-after`)?.status).toBe('passed')
    expect(advisoryOutput(advisory, { ...report, advisories })).toEqual([
      `ADVISORY ${ID} (fails nothing; log ${report.log})`,
      'src/a.test.ts:1:1 coverage-uniqueness advisory: nothing unique',
      `note: about ${ID}`,
    ])
    expect(advisoryOutput(advisory, { ...report, advisories: [] })).toEqual([])
  })

  it('reaches the job summary, and each located finding becomes a notice on its file', () => {
    const report = {
      gate: 'check',
      ok: true,
      steps: [
        {
          id: 'coverage-uniqueness',
          status: 'passed',
          advisories: [
            'src/a.test.ts:1:1 coverage-uniqueness advisory: 100% shared',
            '3 more not checked',
          ],
        },
      ],
    }

    expect(renderJobSummary(report, undefined)).toContain(
      '#### Advisories (fail nothing)\n\n- src/a.test.ts:1:1 coverage-uniqueness advisory: 100% shared\n- 3 more not checked',
    )
    expect(advisoryAnnotations(report)).toEqual([
      '::notice file=src/a.test.ts,line=1::coverage-uniqueness advisory: 100%25 shared',
    ])
  })
})
