import { describe, expect, it } from 'vitest'
import { defaultConcurrency, parseRunArguments } from '../arguments'
import { capFindings, FALLBACK_TAIL_LINES, MAX_PRINTED_FINDINGS, parseFindings } from '../findings'
import { MAX_SCOPED_FILES, planChanged, selectSteps } from '../plan'
import { summaryLine, type StepReport } from '../report'
import { type CheckStep, validateStepGraph, withDependencies } from '../step-model'
import { GATES, STEPS } from '../steps'
import { validateCheckGate } from '../../package-release-validator-check-gate'

function step(id: string, extra: Partial<CheckStep> = {}) {
  const result: CheckStep = {
    id,
    summary: id,
    commands: [['true', id]],
    inputs: [],
    findings: 'generic',
    hint: `rerun ${id}`,
    ...extra,
  }
  return result
}

function report(id: string, status: StepReport['status']) {
  const result: StepReport = {
    id,
    status,
    startMs: 0,
    durationMs: 1000,
    exitCode: 0,
    log: `${id}.log`,
    commands: [],
  }
  return result
}

describe('the declared step graph', () => {
  it('is valid, and every gate step exists', () => {
    expect(validateStepGraph(STEPS, GATES)).toEqual([])
  })

  it('keeps the package release gates in check', () => {
    expect(validateCheckGate(STEPS, GATES)).toEqual([])
  })

  it('reports a package smoke that no longer waits for the package builds', () => {
    const steps = STEPS.map((entry) =>
      entry.id === 'package-smoke' ? { ...entry, dependsOn: ['build:waggle-core'] } : entry,
    )
    expect(validateCheckGate(steps, GATES)).toEqual([
      'scripts/check/steps.ts: package-smoke must depend on build:waggle-core, build:extension-sdk, build:pi-waggle, build:extension-react.',
    ])
  })

  it('builds each package once, however many steps read it', () => {
    const check = GATES.find((gate) => gate.id === 'check')
    if (check === undefined) throw new Error('no check gate')
    const builds = withDependencies(STEPS, check.steps).filter((entry) =>
      entry.id.startsWith('build:'),
    )
    expect(builds.map((entry) => entry.id)).toEqual([
      'build:waggle-core',
      'build:extension-sdk',
      'build:pi-waggle',
      'build:extension-react',
    ])
  })
})

describe('validateStepGraph', () => {
  it('reports unknown dependencies, duplicates and cycles', () => {
    const steps = [
      step('a', { dependsOn: ['b'] }),
      step('b', { dependsOn: ['a'] }),
      step('c', { dependsOn: ['missing'] }),
      step('c'),
    ]
    expect(validateStepGraph(steps, [{ id: 'g', summary: '', steps: ['zzz'] }])).toEqual([
      'step "c" is declared twice',
      'step "c" depends on unknown "missing"',
      'gate "g" lists unknown step "zzz"',
      'dependency cycle: a -> b -> a',
    ])
  })
})

describe('parseRunArguments', () => {
  it('reads the gate, id lists and switches', () => {
    expect(
      parseRunArguments(
        ['verify', '--only', 'lint,format', '--skip=package-smoke', '--changed', '--no-cache'],
        {},
      ),
    ).toMatchObject({
      gate: 'verify',
      only: ['lint', 'format'],
      skip: ['package-smoke'],
      changed: true,
      cache: false,
      list: false,
    })
  })

  it('takes the concurrency from the flag, then CHECK_CONCURRENCY, then the cores', () => {
    expect(parseRunArguments(['--concurrency', '3'], { CHECK_CONCURRENCY: '5' }).concurrency).toBe(
      3,
    )
    expect(parseRunArguments([], { CHECK_CONCURRENCY: '5' }).concurrency).toBe(5)
    expect(defaultConcurrency(14)).toBe(7)
    expect(defaultConcurrency(2)).toBe(2)
  })

  it('rejects unknown options and missing values', () => {
    expect(() => parseRunArguments(['--fast'], {})).toThrow('unknown option --fast')
    expect(() => parseRunArguments(['--only'], {})).toThrow('--only needs a value')
    expect(() => parseRunArguments(['--concurrency', '0'], {})).toThrow('positive integer')
  })
})

describe('selectSteps', () => {
  const steps = [step('build'), step('lint', { dependsOn: ['build'] }), step('docs')]
  const gate = { id: 'check', summary: '', steps: ['lint', 'docs'] }

  it('adds dependencies and drops skipped steps', () => {
    expect(selectSteps(steps, gate, { only: [], skip: ['docs'] }).map((entry) => entry.id)).toEqual(
      ['build', 'lint'],
    )
    expect(selectSteps(steps, gate, { only: ['docs'], skip: [] }).map((entry) => entry.id)).toEqual(
      ['docs'],
    )
  })
})

describe('planChanged', () => {
  const steps = [
    step('build'),
    step('lint', {
      dependsOn: ['build'],
      changedFiles: {
        files: ['src/**/*.ts'],
        fullRunOn: ['lint.config.ts'],
        command: (files) => ['lint', ...files],
      },
    }),
    step('standards', {
      changedFiles: { files: ['**'], command: (files) => ['standards', ...files] },
    }),
    step('typecheck'),
  ]

  it('scopes file-list steps to the changed files and keeps their dependencies', () => {
    const plan = planChanged(steps, steps, ['src/a.ts', 'README.md'])
    expect(plan.map((entry) => [entry.step.id, entry.commands, entry.unchanged])).toEqual([
      ['build', [['true', 'build']], undefined],
      ['lint', [['lint', 'src/a.ts']], undefined],
      ['standards', [['standards', 'src/a.ts', 'README.md']], undefined],
    ])
  })

  it('runs a step whole when its config changed, and skips steps with nothing to check', () => {
    const plan = planChanged(steps, steps, ['lint.config.ts'])
    expect(plan.map((entry) => [entry.step.id, entry.commands])).toEqual([
      ['build', [['true', 'build']]],
      ['lint', [['true', 'lint']]],
      ['standards', [['standards', 'lint.config.ts']]],
    ])
    const docsOnly = planChanged(steps, [steps[1] ?? step('x')], ['docs/a.md'])
    expect(docsOnly.map((entry) => [entry.step.id, entry.unchanged])).toEqual([['lint', true]])
  })

  it('runs a step whole rather than pass it more files than a command line holds', () => {
    const many = Array.from({ length: MAX_SCOPED_FILES + 1 }, (_, index) => `src/f${index}.ts`)
    const plan = planChanged(steps, [steps[1] ?? step('x')], many)
    expect(plan.find((entry) => entry.step.id === 'lint')?.commands).toEqual([['true', 'lint']])
  })
})

describe('findings', () => {
  it('compacts tsc errors to file:line:col code message', () => {
    const log = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"
    expect(parseFindings('tsc', log)).toEqual([
      "src/a.ts:3:7 TS2322 Type 'string' is not assignable to type 'number'.",
    ])
  })

  it('keeps located lines from other tools, else the end of the log', () => {
    expect(parseFindings('generic', 'building\nsrc/a.ts:4: bad thing\ndone\n')).toEqual([
      'src/a.ts:4: bad thing',
    ])
    const noise = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
    const tail = parseFindings('generic', noise)
    expect(tail).toHaveLength(FALLBACK_TAIL_LINES)
    expect(tail.at(-1)).toBe('line 99')
  })

  it('prefers the error line to the end of a noisy log', () => {
    const log = [
      '(!) Some chunks are larger than 500 kB after minification.',
      '105 |     throw new Error(',
      'error: initial renderer is 467002 bytes; budget is 393216 bytes.',
      '      at initialRendererAssets (scripts/check-syntax-bundle.ts:105:15)',
    ].join('\n')
    expect(parseFindings('generic', log)).toEqual([
      'error: initial renderer is 467002 bytes; budget is 393216 bytes.',
    ])
  })

  it('caps the printed findings and points at the log', () => {
    const many = Array.from({ length: MAX_PRINTED_FINDINGS + 5 }, (_, index) => `f:${index}:1 x`)
    const capped = capFindings(many, '.tmp/check/lint.log')
    expect(capped).toHaveLength(MAX_PRINTED_FINDINGS + 1)
    expect(capped.at(-1)).toBe('... 5 more in .tmp/check/lint.log')
  })
})

describe('summaryLine', () => {
  it('is one line when green', () => {
    const reports = [report('a', 'passed'), report('b', 'cached'), report('c', 'unchanged')]
    expect(summaryLine('check', reports, 41_234)).toBe(
      'check: 2 steps passed in 41.2s (1 cached, 1 with no changed files)',
    )
  })

  it('names the failed steps and counts the ones that could not run', () => {
    const reports = [report('a', 'failed'), report('b', 'blocked'), report('c', 'passed')]
    expect(summaryLine('verify', reports, 5_000)).toBe(
      'verify: 1 of 3 steps failed (a) in 5.0s; 1 not run',
    )
  })
})
