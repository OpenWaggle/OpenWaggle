import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { Schema } from '@shared/schema'
import { objectEntries, objectFields, objectMap, unknownField } from '../support/object-fields'

const WORKFLOWS = ['perf-gate.yml', 'perf-report.yml'] as const

const stepSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  uses: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  if: Schema.optional(Schema.String),
  'working-directory': Schema.optional(Schema.String),
  env: unknownField,
  with: unknownField,
})
const jobSchema = Schema.Struct({
  if: Schema.optional(Schema.String),
  permissions: unknownField,
  steps: Schema.Array(Schema.Unknown),
})
const workflowSchema = Schema.Struct({ jobs: unknownField })

function workflowJobs(file: string) {
  const text = fs.readFileSync(path.join(process.cwd(), '.github/workflows', file), 'utf8')
  const jobs = objectEntries(objectFields(workflowSchema, parse(text))?.jobs)
  if (jobs === undefined) throw new Error(`${file} has no jobs.`)
  return jobs.map(([id, value]) => {
    const job = objectFields(jobSchema, value)
    if (job === undefined) throw new Error(`${file} job ${id} is malformed.`)
    const steps = job.steps.map((step) => {
      const parsed = objectFields(stepSchema, step)
      if (parsed === undefined) throw new Error(`${file} job ${id} has a malformed step.`)
      return parsed
    })
    return { id, if: job.if, permissions: objectMap(job.permissions), steps }
  })
}

function gateJob(id: string) {
  const job = workflowJobs('perf-gate.yml').find((candidate) => candidate.id === id)
  if (job === undefined) throw new Error(`perf-gate.yml has no ${id} job.`)
  return job
}

function stepNamed(job: ReturnType<typeof gateJob>, name: string) {
  const step = job.steps.find((candidate) => candidate.name === name)
  if (step === undefined) throw new Error(`${job.id} has no step ${name}.`)
  return { ...step, env: objectMap(step.env), with: objectMap(step.with) }
}

/** Index of the first step whose run or uses matches `pattern`, -1 for none. */
function stepIndex(job: ReturnType<typeof gateJob>, pattern: RegExp) {
  return job.steps.findIndex((step) => pattern.test(step.run ?? step.uses ?? ''))
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

  it('restores the caches CI saves on main, under the same keys', () => {
    const action = fs.readFileSync(
      path.join(process.cwd(), '.github/actions/bun-install/action.yml'),
      'utf8',
    )
    const timings = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/perf-gate.yml'),
      'utf8',
    )

    for (const prefix of [
      'bun-install-${{ runner.os }}-${{ runner.arch }}-',
      'electron-${{ runner.os }}-${{ runner.arch }}-',
    ]) {
      expect(action).toContain(`key: ${prefix}\${{ hashFiles('bun.lock') }}`)
      expect(timings).toContain(`key: ${prefix}\${{ hashFiles('head/bun.lock') }}`)
    }
    // electron/get's cache directory on each OS, which the timing job (Linux) shares.
    expect(action).toContain(
      "path: ${{ runner.os == 'macOS' && '~/Library/Caches/electron' || runner.os == 'Windows' && '~/AppData/Local/electron/Cache' || '~/.cache/electron' }}",
    )
    expect(timings).toContain('path: ~/.cache/electron')
    expect(timings).not.toContain('perf-gate-bun-')
    expect(timings).not.toContain('perf-gate-electron-')
  })

  it.each([
    ['decide', 'steps.refs.outputs.main_sha'],
    ['gate', 'needs.decide.outputs.main_sha'],
  ])('checks out main_sha as trusted/ in %s, then sets up its Bun from it', (id, output) => {
    const job = gateJob(id)
    const checkout = stepNamed(job, "Check out main's gate")

    expect(checkout.env?.get('MAIN_SHA')).toBe(`\${{ ${output} }}`)
    expect(checkout.run).toContain('git worktree add --detach trusted "$MAIN_SHA"')
    const worktree = stepIndex(job, /git worktree add --detach trusted "\$MAIN_SHA"/u)
    const setupBun = job.steps.findIndex((step) => step.uses?.startsWith('oven-sh/setup-bun@'))
    expect(setupBun).toBeGreaterThan(worktree)
    expect(job.steps.filter((step) => step.uses?.startsWith('oven-sh/setup-bun@'))).toHaveLength(1)
    expect(objectMap(job.steps[setupBun]?.with)?.get('bun-version-file')).toBe(
      'trusted/package.json',
    )
  })

  it('installs every trusted checkout without lifecycle scripts', () => {
    const installs = workflowJobs('perf-gate.yml').flatMap((job) =>
      job.steps.flatMap((step) =>
        (step.run ?? '')
          .split('\n')
          .filter((line) => /\bbun install\b/u.test(line))
          .filter((line) => step['working-directory'] === 'trusted' || line.includes('cd trusted'))
          .map((line) => `${job.id}: ${line.trim()}`),
      ),
    )

    expect(installs).toEqual([
      'decide: bun install --frozen-lockfile --ignore-scripts',
      'timings: (cd trusted && bun install --frozen-lockfile --ignore-scripts)',
      'gate: bun install --frozen-lockfile --ignore-scripts',
    ])
  })

  it('lets the gate read the run it belongs to, and fails the labels step when gh fails', () => {
    const gate = gateJob('gate')
    expect(gate.permissions?.get('actions')).toBe('read')
    const labels = stepNamed(gate, 'Read the maintainer labels')
    expect(labels['working-directory']).toBe('trusted')
    expect(labels.run).toMatch(/^set -euo pipefail\n/u)
  })

  it("times with main's harness and thresholds, the head's only while main has no gate", () => {
    const timings = gateJob('timings')
    const checkout = stepNamed(timings, "Check out main's timing harness")
    expect(checkout.with?.get('path')).toBe('trusted')
    expect(checkout.with?.get('ref')).toBe(
      "${{ needs.decide.outputs.gate_fallback == 'true' && needs.decide.outputs.head_sha || needs.decide.outputs.main_sha }}",
    )
    const measure = stepNamed(timings, 'Measure base and head, interleaved')
    expect(measure['working-directory']).toBe('trusted')
    expect(measure.run).toContain('thresholds=performance/perf-gate/thresholds.json')
    expect(measure.run).toContain('idle=$(jq -r .idleMs "$thresholds")')
    expect(measure.run).toContain('bun scripts/perf-gate/ab-run.ts --base ../base --head ../head')
    expect(measure.run).not.toMatch(/(?:base|head)\/(?:scripts|performance)\//u)
  })

  it("reads main's budgets, and allows none only while main has no gate", () => {
    const checkout = stepNamed(gateJob('gate'), "Check out main's gate")
    expect(checkout.env?.get('FALLBACK')).toBe('${{ needs.decide.outputs.gate_fallback }}')
    const [fallback, trusted] = (checkout.run ?? '').split('\nelse\n')
    expect(fallback).toContain('if [ "$FALLBACK" = "true" ]; then')
    expect(fallback).toContain('|| rm -f "$RUNNER_TEMP/main-perf-budgets.json"')
    expect(trusted).toContain(
      'git show "$MAIN_SHA:performance/perf-budgets.json" > "$RUNNER_TEMP/main-perf-budgets.json"',
    )
    expect(trusted).not.toContain('||')
  })
})
