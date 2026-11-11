/**
 * The first setup file of the reused-worker tiers (`REUSED_WORKERS` in `vitest-tier-options.ts`).
 *
 * Vitest's `isolate: true` starts a new worker process for every test file, so each file pays for
 * loading the externals again: on Bun that was ~60% of the unit tier (Effect, and Pi's SDK at
 * seconds per file) and half of the component tier (jsdom). With `isolate: false` Vitest keeps the
 * worker, its native module cache and its environment, but also every module, mock and global the
 * previous file left. This file runs before each test file and gives it what a fresh worker would:
 *
 * - Vitest's module graph and mock registry, reset as Vitest resets them between the files of one
 *   isolated worker, plus any `vi.doMock` still queued. Source, test and setup modules evaluate
 *   again; externals stay loaded.
 * - Real timers, with every timer the previous file left pending cleared; stubbed globals and env
 *   undone; the env, working directory, process listeners and globals the worker started with; the
 *   builtins and global classes code patches in place (the trusted-main network guard rewrites
 *   `child_process`, `net`, `http` and `EventEmitter.prototype` for the life of the process)
 *   (`worker-process-baseline.ts`).
 * - In jsdom, an empty document and empty storage.
 *
 * It cannot reset state kept inside an external package (a client cache in Pi's SDK, say): a test
 * that reads such state clears it first instead of assuming a fresh process.
 *
 * It reaches Vitest's worker state and mocker through the globals Vitest 4 defines and throws when
 * they are missing, so a Vitest upgrade that moves them fails every file instead of leaking state.
 * `__tests__/reused-worker-isolation.integration.test.ts` proves the reset on a real reused worker.
 */
import { expect, vi } from 'vitest'
import {
  captureWorkerProcessBaseline,
  isWorkerProcessBaseline,
  restoreWorkerProcess,
} from './worker-process-baseline'

/** Vitest's own modules, which it never resets either (`resetModules` in Vitest's worker). */
const VITEST_MODULES = [/\/vitest\/dist\//u, /vitest-virtual-\w+\/dist/u, /@vitest\/dist/u]
const BASELINE = Symbol.for('openwaggle.test.reused-worker-baseline')
const UNREACHABLE =
  'reused-worker-isolation.ts cannot reach Vitest 4 worker state (__vitest_worker__) or mocker (__vitest_mocker__); a reused worker would leak modules and mocks between files.'

const scope: Record<PropertyKey, unknown> = globalThis

function field(value: unknown, key: PropertyKey): unknown {
  const holdsFields = (typeof value === 'object' && value !== null) || typeof value === 'function'
  return holdsFields ? Reflect.get(value, key) : undefined
}

function vitestInternals() {
  const state = scope['__vitest_worker__']
  const mocker = scope['__vitest_mocker__']
  const modules = field(field(state, 'evaluatedModules'), 'idToModuleMap')
  const reset = field(mocker, 'reset')
  const pending = field(field(mocker, 'constructor'), 'pendingIds')
  if (!(modules instanceof Map) || typeof reset !== 'function' || !Array.isArray(pending)) {
    throw new Error(UNREACHABLE)
  }
  const filepath = field(state, 'filepath')
  return {
    modules,
    filepath: typeof filepath === 'string' ? filepath : undefined,
    resetMocks: () => {
      Reflect.apply(reset, mocker, [])
      // A `vi.doMock` the previous file queued after its last import would apply to this file.
      pending.length = 0
    },
  }
}

function resetModules(modules: Map<unknown, unknown>) {
  const self = new URL(import.meta.url).pathname
  for (const [id, node] of modules) {
    if (typeof id !== 'string' || typeof node !== 'object' || node === null) continue
    if (id === self || VITEST_MODULES.some((pattern) => pattern.test(id))) continue
    Reflect.set(node, 'promise', undefined)
    Reflect.set(node, 'exports', undefined)
    Reflect.set(node, 'evaluated', false)
    const importers = field(node, 'importers')
    if (importers instanceof Set) importers.clear()
  }
}

function resetDocument() {
  if (typeof document === 'undefined') return
  document.head.replaceChildren()
  document.body.replaceChildren()
  for (const element of [document.documentElement, document.body]) {
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)
  }
  document.title = ''
  window.localStorage.clear()
  window.sessionStorage.clear()
}

function keepGlobal(key: PropertyKey) {
  return key === BASELINE || (typeof key === 'string' && key.startsWith('__vitest'))
}

const { modules, filepath, resetMocks } = vitestInternals()
const baseline = scope[BASELINE]
if (isWorkerProcessBaseline(baseline)) {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  restoreWorkerProcess(baseline, keepGlobal)
  resetDocument()
} else {
  scope[BASELINE] = captureWorkerProcessBaseline()
}
resetMocks()
resetModules(modules)
// Vitest sets the global expect's test path once per worker.
if (filepath !== undefined) expect.setState({ testPath: filepath })
