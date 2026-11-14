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
  globalBinding,
  setGlobalBinding,
  captureWorkerProcessBaseline,
  isWorkerProcessBaseline,
  restoreWorkerProcess,
} from './worker-process-baseline'

/** Vitest's own modules, which it never resets either (`resetModules` in Vitest's worker). */
const VITEST_MODULES = [/\/vitest\/dist\//u, /vitest-virtual-\w+\/dist/u, /@vitest\/dist/u]
const BASELINE = Symbol.for('openwaggle.test.reused-worker-baseline')
const UNREACHABLE =
  'reused-worker-isolation.ts cannot reach Vitest 4 worker state (__vitest_worker__) or mocker (__vitest_mocker__); a reused worker would leak modules and mocks between files.'

function field(value: unknown, key: PropertyKey) {
  const holdsFields = (typeof value === 'object' && value !== null) || typeof value === 'function'
  const result: unknown = holdsFields ? Reflect.get(value, key) : undefined
  return result
}

function vitestInternals() {
  const state = field(globalThis, '__vitest_worker__')
  const mocker = field(globalThis, '__vitest_mocker__')
  const evaluated = field(state, 'evaluatedModules')
  const graph = {
    byId: field(evaluated, 'idToModuleMap'),
    byUrl: field(evaluated, 'urlToIdModuleMap'),
    byFile: field(evaluated, 'fileToModulesMap'),
  }
  const reset = field(mocker, 'reset')
  const pending = field(field(mocker, 'constructor'), 'pendingIds')
  const fetches = field(field(mocker, 'moduleRunner'), 'concurrentModuleNodePromises')
  const { byId, byUrl, byFile } = graph
  if (
    !(byId instanceof Map) ||
    !(byUrl instanceof Map) ||
    !(byFile instanceof Map) ||
    !(fetches instanceof Map) ||
    typeof reset !== 'function' ||
    !Array.isArray(pending)
  ) {
    throw new Error(UNREACHABLE)
  }
  const filepath = field(state, 'filepath')
  return {
    graph: { byId, byUrl, byFile, fetches },
    filepath: typeof filepath === 'string' ? filepath : undefined,
    resetMocks: () => {
      Reflect.apply(reset, mocker, [])
      // A `vi.doMock` the previous file queued after its last import would apply to this file.
      pending.length = 0
    },
  }
}

interface ModuleGraph {
  readonly byId: Map<unknown, unknown>
  readonly byUrl: Map<unknown, unknown>
  readonly byFile: Map<unknown, unknown>
  /** The module runner's fetches in progress, by URL. */
  readonly fetches: Map<unknown, unknown>
}

/** How long a file waits for the imports the previous file left running, at most. */
const SETTLE_IMPORTS_MS = 2_000

function isResettable(id: unknown, self: string): id is string {
  return (
    typeof id === 'string' && id !== self && !VITEST_MODULES.some((pattern) => pattern.test(id))
  )
}

function importsInProgress({ byId, fetches }: ModuleGraph, self: string) {
  const running: unknown[] = [...fetches.values()]
  for (const [id, node] of byId) {
    if (isResettable(id, self) && field(node, 'evaluated') === false) {
      running.push(field(node, 'promise'))
    }
  }
  return running.filter((value) => value instanceof Promise)
}

/**
 * Waits, for a bounded time, for the imports the previous file started and did not await (a lazy
 * component, a fire-and-forget `import()`). One that ends after the reset would evaluate against
 * this file's mock registry and put its module back in the graph, where this file's import of it
 * would find it already evaluated.
 */
async function settleImports(graph: ModuleGraph, self: string) {
  const deadline = Date.now() + SETTLE_IMPORTS_MS
  let running = importsInProgress(graph, self)
  while (running.length > 0 && Date.now() < deadline) {
    const remaining = deadline - Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(running),
      new Promise((resolve) => {
        timer = setTimeout(resolve, remaining)
      }),
    ])
    clearTimeout(timer)
    // An import that ended may have started others.
    running = importsInProgress(graph, self)
  }
}

/**
 * Drops every module from the graph, so this file fetches and evaluates each one again into a new
 * node. Vitest resets the nodes in place between the files of an isolated worker, which is not
 * enough here: an import the previous file left running (a lazy component, a mock factory) ends
 * later and writes its exports, bound to that file's mocks, into the node it started with. A mocked
 * module's fetched metadata also names the previous file's mock.
 */
function resetModules({ byId, byUrl, byFile }: ModuleGraph, self: string) {
  const dropped = new Set<unknown>()
  for (const [id, node] of byId) {
    if (!isResettable(id, self)) continue
    byId.delete(id)
    dropped.add(node)
  }
  for (const [url, node] of byUrl) if (dropped.has(node)) byUrl.delete(url)
  for (const [file, nodes] of byFile) {
    if (!(nodes instanceof Set)) continue
    for (const node of dropped) nodes.delete(node)
    if (nodes.size === 0) byFile.delete(file)
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

const self = new URL(import.meta.url).pathname
const { graph, filepath, resetMocks } = vitestInternals()
const baseline = globalBinding(BASELINE)
if (isWorkerProcessBaseline(baseline)) {
  vi.useRealTimers()
  // Before the timers the previous file left are cleared, as its imports may wait on them.
  await settleImports(graph, self)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  restoreWorkerProcess(baseline, keepGlobal)
  resetDocument()
} else {
  setGlobalBinding(BASELINE, captureWorkerProcessBaseline())
}
resetMocks()
resetModules(graph, self)
// Vitest sets the global expect's test path once per worker.
if (filepath !== undefined) expect.setState({ testPath: filepath })
