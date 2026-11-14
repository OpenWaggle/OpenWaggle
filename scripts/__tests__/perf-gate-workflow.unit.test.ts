import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { Schema } from '@shared/schema'
import { objectFields } from '../support/object-fields'

const WORKFLOWS = ['perf-gate.yml', 'perf-report.yml'] as const

const stepSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  uses: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  if: Schema.optional(Schema.String),
  'working-directory': Schema.optional(Schema.String),
})
const jobSchema = Schema.Struct({
  if: Schema.optional(Schema.String),
  steps: Schema.Array(Schema.Unknown),
})
const workflowSchema = Schema.Struct({
  jobs: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

function workflowJobs(file: string) {
  const text = fs.readFileSync(path.join(process.cwd(), '.github/workflows', file), 'utf8')
  const workflow = objectFields(workflowSchema, parse(text))
  if (workflow === undefined) throw new Error(`${file} has no jobs.`)
  return Object.entries(workflow.jobs).map(([id, value]) => {
    const job = objectFields(jobSchema, value)
    if (job === undefined) throw new Error(`${file} job ${id} is malformed.`)
    const steps = job.steps.map((step) => {
      const parsed = objectFields(stepSchema, step)
      if (parsed === undefined) throw new Error(`${file} job ${id} has a malformed step.`)
      return parsed
    })
    return { id, if: job.if, steps }
  })
}

/** A step that runs a TypeScript file or a package script with Bun. */
const RUNS_BUN_CODE = /\bbun (?:scripts\/|run |"\$)/u

describe('Performance Gate workflows', () => {
  it.each(WORKFLOWS)('installs dependencies in %s before any step runs code with Bun', (file) => {
    const missing: string[] = []
    for (const job of workflowJobs(file)) {
      const installed = new Set<string>()
      for (const step of job.steps) {
        const run = step.run ?? ''
        const directory = step['working-directory'] ?? '.'
        if (/\bbun install\b/u.test(run)) installed.add(/\(cd /u.test(run) ? '*' : directory)
        if (RUNS_BUN_CODE.test(run) && !installed.has(directory) && !installed.has('*')) {
          missing.push(`${job.id}: ${step.name ?? run.slice(0, 60)}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('runs every gate command inside main checkout, never the pull request one', () => {
    const outside = workflowJobs('perf-gate.yml').flatMap((job) =>
      job.steps
        .filter((step) => (step.run ?? '').includes('bun scripts/perf-gate/gate.ts'))
        .filter((step) => step['working-directory'] !== 'trusted')
        .map((step) => `${job.id}: ${step.name ?? ''}`),
    )
    expect(outside).toEqual([])
  })

  it('fails the judge step unless the decide job said exactly true or false', () => {
    const gate = workflowJobs('perf-gate.yml').find((job) => job.id === 'gate')
    const judge = gate?.steps.find((step) => step.name === 'Judge budgets and timings')
    expect(judge?.run).toContain('case "$RUN_TIMINGS" in\n  true | false) ;;')
    expect(judge?.run).toContain('neither true nor false."; exit 1 ;;')
  })

  it('posts no check for a run a newer push cancelled', () => {
    const gate = workflowJobs('perf-gate.yml').find((job) => job.id === 'gate')
    expect(gate?.if).toContain('!cancelled()')
    expect(gate?.if).not.toContain('always()')
    expect(gate?.steps.filter((step) => step.if?.includes('always()'))).toEqual([])
  })
})
