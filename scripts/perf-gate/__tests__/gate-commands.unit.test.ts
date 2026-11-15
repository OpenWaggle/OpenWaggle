import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AbResults } from '../ab-run'
import type { AbSample } from '../ab-sample'
import { main } from '../gate'

const MIB = 1_048_576
const THRESHOLDS = path.join(process.cwd(), 'performance/perf-gate/thresholds.json')
const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function workDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-gate-commands-'))
  directories.push(directory)
  return directory
}

function sample(build: 'base' | 'head', order: number, chatReadyMs: number | null) {
  const launch = {
    windowReadyMs: 600,
    backendReadyMs: 900,
    chatReadyMs,
    ipcCallsUntilChatReady: 22,
    ipcChannelsUntilChatReady: null,
  }
  const memory = { rssBytes: 600 * MIB, processCount: 6, byRole: { main: 200 * MIB } }
  const result: AbSample = {
    build,
    order,
    cold: launch,
    warm: launch,
    idle: memory,
    afterTurn: memory,
    turnMs: 900,
  }
  return result
}

function writeResults(directory: string, samples: readonly AbSample[]) {
  const results: AbResults = {
    platform: 'linux',
    arch: 'x64',
    pairs: 10,
    idleMs: 5_000,
    builds: { base: { label: 'base' }, head: { label: 'head' } },
    samples: [...samples],
  }
  const file = path.join(directory, 'ab.json')
  fs.writeFileSync(file, JSON.stringify(results))
  return file
}

function timings(results: string, out: string) {
  return main([
    'timings',
    '--results',
    results,
    '--thresholds',
    THRESHOLDS,
    '--head-thresholds',
    THRESHOLDS,
    '--out',
    out,
  ])
}

function budgetFile(directory: string, name: string, value: number) {
  const file = path.join(directory, name)
  const metrics = { 'package.runtime.packages': { value, quantum: 1 } }
  fs.writeFileSync(file, JSON.stringify({ about: '', metrics }))
  return file
}

describe('the Performance Gate commands', () => {
  it('reports a timing regression, a missing head value and too few pairs, and exits 0', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const directory = workDirectory()
    const slower = Array.from({ length: 10 }, (_, index) => [
      sample('base', index + 1, 1_400),
      sample('head', index + 1, 1_900),
    ]).flat()
    const out = path.join(directory, 'timings.json')

    expect(timings(writeResults(directory, slower), out)).toBe(0)
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({
      regressions: [{ id: 'cold.chat-ready' }, { id: 'warm.chat-ready' }],
      incomplete: [],
    })
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).not.toHaveProperty('passed')

    const unmeasured = [sample('base', 1, 1_400), sample('head', 1, null)]
    expect(timings(writeResults(directory, unmeasured), out)).toBe(0)
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({
      regressions: [{ status: 'missing' }, { status: 'missing' }],
      incomplete: [expect.stringContaining('the comparison needs 10.')],
    })
  })

  it('fails a raised budget only until the budget label accepts it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const directory = workDirectory()
    const base = budgetFile(directory, 'main.json', 100)
    const head = budgetFile(directory, 'head.json', 101)
    const out = path.join(directory, 'budgets.json')
    const budgets = (labels: string) =>
      main(['budgets', '--base', base, '--head', head, '--labels', labels, '--out', out])

    expect(budgets('')).toBe(1)
    expect(budgets('perf-budget-increase')).toBe(0)
  })
})
