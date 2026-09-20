import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'

const PROCESS_READINESS_TIMEOUT_MS = 5_000
const PROCESS_READINESS_POLL_INTERVAL_MS = 10

export interface ProcessIdentity {
  readonly descendantPid: number
  readonly processGroupId: number
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    throw error
  }
}

export function processGroupExists(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    throw error
  }
}

function assertProcessIdentity(value: unknown): asserts value is ProcessIdentity {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('descendantPid' in value) ||
    !('processGroupId' in value) ||
    typeof value.descendantPid !== 'number' ||
    typeof value.processGroupId !== 'number' ||
    !Number.isSafeInteger(value.descendantPid) ||
    !Number.isSafeInteger(value.processGroupId) ||
    value.descendantPid <= 0 ||
    value.processGroupId <= 0
  ) {
    throw new Error('Process readiness identity was invalid.')
  }
}

export async function waitForProcessIdentity(filePath: string) {
  const deadline = Date.now() + PROCESS_READINESS_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
      assertProcessIdentity(parsed)
      return parsed
    } catch (error) {
      if (error instanceof SyntaxError || errorCode(error) === 'ENOENT') {
        await new Promise((resolve) => setTimeout(resolve, PROCESS_READINESS_POLL_INTERVAL_MS))
        continue
      }
      throw error
    }
  }
  throw new Error(`Timed out waiting for process readiness at ${filePath}.`)
}

export function processTreeScript(readinessPath: string, exitRootAfterReady: boolean) {
  const descendantScript = 'setInterval(() => undefined, 1000)'
  return [
    `const fs = require('node:fs')`,
    `const { spawn } = require('node:child_process')`,
    `const descendant = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' })`,
    `if (descendant.pid === undefined) throw new Error('Descendant PID unavailable')`,
    `fs.writeFileSync(${JSON.stringify(readinessPath)}, JSON.stringify({ descendantPid: descendant.pid, processGroupId: process.pid }))`,
    exitRootAfterReady ? 'process.exit(0)' : 'setInterval(() => undefined, 1000)',
  ].join(';')
}

export function forceStopProcessTree(identity: ProcessIdentity | undefined) {
  if (identity === undefined) return
  try {
    process.kill(-identity.processGroupId, 'SIGKILL')
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
  try {
    process.kill(identity.descendantPid, 'SIGKILL')
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

export function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer)
      child.off('error', onError)
      resolve()
    }
    const onError = (error: Error) => {
      clearTimeout(timer)
      child.off('exit', onExit)
      reject(error)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      child.off('error', onError)
      reject(new Error('Timed out waiting for the process-tree fixture root to exit.'))
    }, PROCESS_READINESS_TIMEOUT_MS)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}
