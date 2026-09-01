import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JOB_START_TIMEOUT_MS = 15_000
const JOB_STOP_TIMEOUT_MS = 5_000
const JOB_POLL_INTERVAL_MS = 25
const MAX_LOG_BYTES = 64_000
const MAX_WINDOWS_EXIT_CODE = 0xffff_ffff
const POWERSHELL = 'powershell.exe'
const LAUNCHER_PATH = fileURLToPath(new URL('./windows-job-object-launcher.ps1', import.meta.url))

export type WindowsJobState =
  | { readonly status: 'assigned'; readonly rootPid: number }
  | { readonly status: 'root-exited'; readonly exitCode: number }
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly message: string }

interface WaitForWindowsJobStateDependencies {
  readonly childExited: () => boolean
  readonly now?: () => number
  readonly readStatus: () => Promise<string>
  readonly wait?: (milliseconds: number) => Promise<void>
}

export interface WindowsJobObjectProcess {
  readonly logs: () => string
  readonly rootPid: number
  terminateAndWait(): Promise<void>
  waitForNormalExit(): Promise<void>
  waitForEmpty(): Promise<void>
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseWindowsExitCode(value: string) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_WINDOWS_EXIT_CODE ? parsed : null
}

function parseWindowsJobStates(contents: string) {
  const states: WindowsJobState[] = []
  for (const line of contents.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
    const separator = line.indexOf('\t')
    if (separator < 0) continue
    const status = line.slice(0, separator)
    const detail = line.slice(separator + 1)
    if (status === 'empty' && detail === '0') states.push({ status: 'empty' })
    if (status === 'assigned') {
      const rootPid = parsePositiveInteger(detail)
      if (rootPid !== null) states.push({ status: 'assigned', rootPid })
    }
    if (status === 'root-exited') {
      const exitCode = parseWindowsExitCode(detail)
      if (exitCode !== null) states.push({ status: 'root-exited', exitCode })
    }
    if (status === 'failed') {
      states.push({ status: 'failed', message: Buffer.from(detail, 'base64').toString('utf8') })
    }
  }
  return states
}

export function parseWindowsJobStatus(contents: string): WindowsJobState | null {
  return parseWindowsJobStates(contents).at(-1) ?? null
}

function resolveExpectedWindowsJobState(
  expected: 'assigned' | 'empty' | 'normal-exit',
  states: readonly WindowsJobState[],
) {
  const state = states.at(-1)
  if (state?.status === 'failed') {
    throw new Error(`Windows Job Object launcher failed: ${state.message}`)
  }
  if (expected === 'assigned') {
    return states.find((candidate) => candidate.status === 'assigned') ?? null
  }
  if (expected === 'empty') return state?.status === 'empty' ? state : null
  const rootExit = states.find((candidate) => candidate.status === 'root-exited')
  if (rootExit?.status !== 'root-exited') return null
  if (rootExit.exitCode !== 0) {
    throw new Error(`Windows Job Object root exited with code ${String(rootExit.exitCode)}.`)
  }
  return state?.status === 'empty' ? rootExit : null
}

export async function waitForWindowsJobState(
  expected: 'assigned' | 'empty' | 'normal-exit',
  timeoutMs: number,
  dependencies: WaitForWindowsJobStateDependencies,
) {
  const now = dependencies.now ?? Date.now
  const wait =
    dependencies.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    const states = parseWindowsJobStates(await dependencies.readStatus())
    const resolved = resolveExpectedWindowsJobState(expected, states)
    if (resolved !== null) return resolved
    if (dependencies.childExited()) {
      throw new Error(`Windows Job Object owner exited before ${expected} was proven.`)
    }
    await wait(JOB_POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out before Windows Job Object state ${expected} was proven.`)
}

function appendBoundedLog(current: string, chunk: unknown) {
  const next = `${current}${String(chunk)}`
  return next.length <= MAX_LOG_BYTES ? next : next.slice(-MAX_LOG_BYTES)
}

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (childExited(child)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(childExited(child))
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function readStatus(statusPath: string) {
  try {
    return await fs.readFile(statusPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return ''
    throw error
  }
}

function jobController(input: {
  readonly child: ChildProcess
  readonly controlRoot: string
  readonly logs: () => string
  readonly rootPid: number
  readonly statusPath: string
  readonly stopPath: string
}): WindowsJobObjectProcess {
  const waitForState = (expected: 'assigned' | 'empty' | 'normal-exit', timeoutMs: number) =>
    waitForWindowsJobState(expected, timeoutMs, {
      childExited: () => childExited(input.child),
      readStatus: () => readStatus(input.statusPath),
    })
  const proveOwnerExit = async () => {
    if (await waitForChildExit(input.child, JOB_STOP_TIMEOUT_MS)) return
    input.child.kill('SIGKILL')
    if (!(await waitForChildExit(input.child, JOB_STOP_TIMEOUT_MS))) {
      throw new Error(`Windows Job Object owner would not exit: ${input.controlRoot}`)
    }
  }
  return {
    logs: input.logs,
    rootPid: input.rootPid,
    waitForNormalExit: async () => {
      await waitForState('normal-exit', JOB_START_TIMEOUT_MS)
    },
    waitForEmpty: async () => {
      await waitForState('empty', JOB_START_TIMEOUT_MS)
    },
    terminateAndWait: async () => {
      try {
        const current = parseWindowsJobStatus(await readStatus(input.statusPath))
        if (current?.status !== 'empty') {
          await fs.writeFile(input.stopPath, 'terminate\n')
          await waitForState('empty', JOB_STOP_TIMEOUT_MS)
        }
      } catch (error) {
        input.child.kill('SIGKILL')
        await waitForChildExit(input.child, JOB_STOP_TIMEOUT_MS)
        throw new AggregateError(
          [error],
          `Windows Job Object closed without ActiveProcesses == 0 proof: ${input.controlRoot}`,
          { cause: error },
        )
      }
      await proveOwnerExit()
      await fs.rm(input.controlRoot, { recursive: true, force: true })
    },
  }
}

export async function launchInWindowsJobObject(
  executable: string,
  environment: Record<string, string>,
  args: readonly string[] = [],
) {
  if (process.platform !== 'win32') {
    throw new Error('Windows Job Object launch is available only on Windows.')
  }
  const controlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-job-'))
  const statusPath = path.join(controlRoot, 'status.log')
  const stopPath = path.join(controlRoot, 'stop')
  const encodedArguments = Buffer.from(JSON.stringify(args), 'utf8').toString('base64')
  const child = spawn(
    POWERSHELL,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      LAUNCHER_PATH,
      '-Executable',
      executable,
      '-WorkingDirectory',
      process.cwd(),
      '-StatusPath',
      statusPath,
      '-StopPath',
      stopPath,
      '-TargetArgumentsBase64',
      encodedArguments,
    ],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  let logs = ''
  child.stdout.on('data', (chunk) => {
    logs = appendBoundedLog(logs, chunk)
  })
  child.stderr.on('data', (chunk) => {
    logs = appendBoundedLog(logs, chunk)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  } catch (error) {
    await fs.rm(controlRoot, { recursive: true, force: true })
    throw error
  }
  let assigned: WindowsJobState
  try {
    assigned = await waitForWindowsJobState('assigned', JOB_START_TIMEOUT_MS, {
      childExited: () => childExited(child),
      readStatus: () => readStatus(statusPath),
    })
  } catch (error) {
    child.kill('SIGKILL')
    await waitForChildExit(child, JOB_STOP_TIMEOUT_MS)
    throw new AggregateError(
      [error],
      `Windows Job Object assignment was not proven; evidence retained at ${controlRoot}: ${logs}`,
      { cause: error },
    )
  }
  if (assigned.status !== 'assigned') throw new Error('Windows Job Object assignment was not proven.')
  return jobController({ child, controlRoot, logs: () => logs, rootPid: assigned.rootPid, statusPath, stopPath })
}
