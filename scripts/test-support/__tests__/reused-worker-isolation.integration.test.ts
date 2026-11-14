import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { REUSED_WORKER_SETUP } from '../vitest-tier-options'

const run = promisify(execFile)
const VITEST = path.resolve('node_modules/vitest/vitest.mjs')
const RUN_TIMEOUT_MS = 120_000

/** Two files for one reused worker: the larger runs first and dirties it; the other checks. */
const FIXTURES = {
  'module-state.ts': `let count = 0
export function bump() {
  count += 1
  return count
}
export const label = 'real'
`,
  'automocked.ts': `export function flush() {
  return 'real'
}
`,
  'flavour.ts': `export const flavour = 'real'
`,
  'consumer.ts': `import { flavour } from './flavour'
export const seen = flavour
`,
  'a-dirty.test.ts': `import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync } from 'node:fs'
import { bump, label } from './module-state'
// Vitest runs larger files first when it has no timings: this one must run before the other.
// ................................................................................................
import * as automocked from './automocked'
vi.mock('./module-state', async (importOriginal) => ({ ...(await importOriginal<object>()), label: 'mocked' }))
vi.mock('./automocked', () => ({ other: 1 }))
vi.mock('./flavour', () => ({ flavour: 'dirty' }))
it('dirties the worker', () => {
  expect(Reflect.get(automocked, 'other')).toBe(1)
  appendFileSync(process.env.PID_LOG!, process.pid + '\\n')
  expect(bump()).toBe(1)
  expect(label).toBe('mocked')
  Reflect.set(globalThis, 'leakedGlobal', 1)
  process.env.LEAKED_ENV = '1'
  Reflect.set(childProcess, 'spawn', () => 'patched')
  Reflect.set(EventEmitter.prototype, 'on', () => 'patched')
  process.on('beforeExit', () => undefined)
  process.exitCode = 3
  // An import left running, which ends after this file does.
  void import('./consumer')
  vi.useFakeTimers()
})
`,
  'b-clean.test.ts': `import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync } from 'node:fs'
import { bump, label } from './module-state'
import { flush } from './automocked'
vi.mock('./automocked')
vi.mock('./flavour', () => ({ flavour: 'clean' }))
it('starts from what a fresh worker gives', async () => {
  await new Promise((resolve) => setTimeout(resolve, 200))
  const { seen } = await import('./consumer')
  appendFileSync(process.env.PID_LOG!, process.pid + '\\n')
  expect({
    count: bump(),
    label,
    global: Reflect.get(globalThis, 'leakedGlobal'),
    env: process.env.LEAKED_ENV,
    spawn: String(childProcess.spawn).includes('patched'),
    on: String(EventEmitter.prototype.on).includes('patched'),
    listeners: process.listeners('beforeExit').length,
    fakeTimers: vi.isFakeTimers(),
    exitCode: process.exitCode ?? 0,
    automocked: vi.isMockFunction(flush),
    seen,
  }).toEqual({ count: 1, label: 'real', global: undefined, env: undefined, spawn: false, on: false, listeners: 0, fakeTimers: false, exitCode: 0, automocked: true, seen: 'clean' })
  process.exitCode = 0
})
`,
}

let directory = ''

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

async function runFixtures(setupFiles: readonly string[]) {
  directory = await mkdtemp(path.join(os.tmpdir(), 'reused-worker-'))
  for (const [name, source] of Object.entries(FIXTURES)) {
    await writeFile(path.join(directory, name), source)
  }
  const config = { test: { globals: true, isolate: false, maxWorkers: 1, setupFiles } }
  await writeFile(
    path.join(directory, 'vitest.config.mjs'),
    `export default ${JSON.stringify(config)}\n`,
  )
  const pidLog = path.join(directory, 'pids')
  const result = await run(process.execPath, ['--bun', VITEST, 'run', '--root', directory], {
    cwd: directory,
    env: { ...fixtureEnv(), PID_LOG: pidLog, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
    timeout: RUN_TIMEOUT_MS,
  }).then(
    (output) => ({ passed: true, output: output.stdout + output.stderr }),
    (error: unknown) => ({ passed: false, output: failedOutput(error) }),
  )
  const pids = new Set((await readFile(pidLog, 'utf8')).split('\n').filter(Boolean))
  return { ...result, workers: pids.size }
}

/** The parent's env without VITEST_MAX_WORKERS, which overrides the fixture config's one worker. */
function fixtureEnv() {
  const { VITEST_MAX_WORKERS: _ignored, ...env } = process.env
  return env
}

function failedOutput(error: unknown) {
  const stream = (key: 'stdout' | 'stderr') => {
    const value: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, key) : ''
    return typeof value === 'string' ? value : ''
  }
  return stream('stdout') + stream('stderr')
}

describe('the reused-worker reset', () => {
  it(
    'gives a second file in one worker the modules, mocks and process state of a fresh one',
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const result = await runFixtures([path.resolve(REUSED_WORKER_SETUP)])

      expect(result.output).toContain('2 passed')
      expect(result).toMatchObject({ passed: true, workers: 1 })
    },
  )

  // Proves the fixtures detect a leak: without the reset the second file sees the first's state.
  it(
    'lets the first file leak into the second without it',
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const result = await runFixtures([])

      expect(result).toMatchObject({ passed: false, workers: 1 })
      expect(result.output).toContain('starts from what a fresh worker gives')
    },
  )
})
