import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { build } from 'vite'
import { buildSafeElectronEnvironment } from '../../safe-electron-environment'
import {
  snapshotWindowsProcessTree,
  verifyWindowsProcessTreeExit,
  type WindowsProcessIdentity,
} from '../windows-process-tree'
import { WINDOWS_DETACHED_PROCESS_SENTINEL_KEY } from './windows-detached-process-values'

// Allow the 20s native helper and 10s child-ready bounds, plus setup margin.
const READY_TIMEOUT_MS = 35_000
const PARENT_CLOSE_TIMEOUT_MS = 5_000
const CHILD_CLEANUP_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 25
const OUTPUT_LIMIT = 2_000

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return true
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function cleanupProbe(input: {
  readonly directory: string
  readonly parent: ChildProcess
  readonly isParentClosed: () => boolean
  readonly childSnapshot: readonly WindowsProcessIdentity[]
}) {
  await fs.writeFile(path.join(input.directory, 'stop-child'), '')
  const childStopped = await waitUntil(
    () => exists(path.join(input.directory, 'child-stopped')),
    CHILD_CLEANUP_TIMEOUT_MS,
  )
  if (input.parent.exitCode === null && input.parent.signalCode === null) {
    input.parent.kill('SIGKILL')
  }
  const parentClosed = await waitUntil(input.isParentClosed, PARENT_CLOSE_TIMEOUT_MS)
  const ownedChildExited =
    input.childSnapshot.length > 0 &&
    (await waitUntil(
      () => verifyWindowsProcessTreeExit(input.childSnapshot),
      PARENT_CLOSE_TIMEOUT_MS,
    ))
  if (!childStopped || !parentClosed || !ownedChildExited) {
    throw new Error(`Detached-process probe cleanup was incomplete; retained ${input.directory}.`)
  }
  await fs.rm(input.directory, { recursive: true, force: true, maxRetries: 5 })
}

async function finishProbe(
  input: Parameters<typeof cleanupProbe>[0],
  originalFailure: unknown,
) {
  try {
    await cleanupProbe(input)
  } catch (error) {
    if (originalFailure !== undefined) {
      throw new AggregateError(
        [originalFailure, error],
        'Detached-process probe failed and its private directory could not be removed safely.',
        { cause: error },
      )
    }
    throw error
  }
}

export async function probeWindowsDetachedHandleIsolation() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-detached-handles-蜂 '))
  const expectedEnvironmentSentinel = `qa-${randomUUID()}`
  const fixturePath = path.join(directory, 'fixture.cjs')
  await Promise.all(['parent', 'child'].map((mode) => fs.mkdir(path.join(directory, mode))))
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    resolve: {
      alias: { '@shared': fileURLToPath(new URL('../../../src/shared', import.meta.url)) },
    },
    ssr: { noExternal: true, external: ['electron'] },
    build: {
      ssr: fileURLToPath(new URL('./fixtures/windows-detached-process.fixture.ts', import.meta.url)),
      outDir: directory,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: 'fixture.cjs' },
      },
    },
  })
  const electronExecutablePath: unknown = createRequire(import.meta.url)('electron')
  if (typeof electronExecutablePath !== 'string') {
    throw new Error('Node did not resolve the Electron executable path.')
  }

  const parent = spawn(electronExecutablePath, [fixturePath, 'parent', directory], {
    env: buildSafeElectronEnvironment({
      OPENWAGGLE_AUTOMATION: '1',
      [WINDOWS_DETACHED_PROCESS_SENTINEL_KEY]: expectedEnvironmentSentinel,
    }),
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let exited = false
  let closed = false
  let processError: Error | undefined
  let stderr = ''
  let childSnapshot: readonly WindowsProcessIdentity[] = []
  let originalFailure: unknown
  const closedPipes = new Set<number>()
  parent.on('exit', () => {
    exited = true
  })
  parent.on('close', () => {
    closed = true
  })
  parent.on('error', (error) => {
    processError = error
  })
  parent.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-OUTPUT_LIMIT)
  })
  for (const [index, pipe] of parent.stdio.entries()) {
    pipe?.on('close', () => closedPipes.add(index))
  }
  parent.stdout?.resume()

  try {
    if (!(await waitUntil(() => exists(path.join(directory, 'parent-ready.json')), READY_TIMEOUT_MS))) {
      throw new Error(`Detached-process fixture did not become ready: ${String(processError)} ${stderr}`)
    }
    const identity = await fs.readFile(path.join(directory, 'parent-ready.json'), 'utf8')
    const childIdentity = await fs.readFile(path.join(directory, 'child-ready.json'), 'utf8')
    const parsedChildIdentity: unknown = JSON.parse(childIdentity)
    assertMatching(
      {
        pid: P.integer,
        arguments: P.array(P.string),
        environmentSentinel: P.string,
      },
      parsedChildIdentity,
    )
    childSnapshot = await snapshotWindowsProcessTree(parsedChildIdentity.pid)
    if (!childSnapshot.some((entry) => entry.processId === parsedChildIdentity.pid)) {
      throw new Error('Detached child exited before its identity could be captured.')
    }
    const pipesClosedBeforeChildRelease = await waitUntil(() => closed, PARENT_CLOSE_TIMEOUT_MS)
    const childStoppedBeforeRelease = await exists(path.join(directory, 'child-stopped'))
    const childAliveAfterParentClose = !(await verifyWindowsProcessTreeExit(
      childSnapshot.filter((entry) => entry.processId === parsedChildIdentity.pid),
    ))
    const result = {
      exited,
      exitCode: parent.exitCode,
      pipesClosedBeforeChildRelease,
      closedPipes: [...closedPipes].toSorted(),
      childStoppedBeforeRelease,
      childAliveAfterParentClose,
      childArguments: parsedChildIdentity.arguments,
      childEnvironmentSentinel: parsedChildIdentity.environmentSentinel,
      expectedEnvironmentSentinel,
      identity,
      childIdentity,
      stderr,
    }
    console.info('[windows-detached-handles]', JSON.stringify(result))
    return result
  } catch (error) {
    originalFailure = error
    throw error
  } finally {
    await finishProbe({ directory, parent, isParentClosed: () => closed, childSnapshot }, originalFailure)
  }
}
