import { execFile, type ChildProcess } from 'node:child_process'

const TERMINATION_TIMEOUT_MS = 5_000
const PROCESS_GROUP_POLL_INTERVAL_MS = 100

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export function windowsTaskkillArguments(pid: number) {
  return ['/pid', String(pid), '/t', '/f']
}

function killWindowsProcessTree(pid: number) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      'taskkill.exe',
      windowsTaskkillArguments(pid),
      { windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

function signalChildGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

function isChildProcessGroupAlive(child: ChildProcess) {
  if (!child.pid) return false
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null
  }
  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
}

async function waitForChildProcessGroupExit(child: ChildProcess) {
  const deadline = Date.now() + TERMINATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!isChildProcessGroupAlive(child)) return true
    await delay(PROCESS_GROUP_POLL_INTERVAL_MS)
  }
  return !isChildProcessGroupAlive(child)
}

export async function stopElectronQaChild(child: ChildProcess) {
  if (process.platform === 'win32') {
    if (!child.pid || !isChildProcessGroupAlive(child)) return
    await killWindowsProcessTree(child.pid)
    if (!(await waitForChildProcessGroupExit(child))) {
      throw new Error('Electron QA process tree remained alive after taskkill.')
    }
    return
  }
  if (!isChildProcessGroupAlive(child)) return
  signalChildGroup(child, 'SIGTERM')
  if (await waitForChildProcessGroupExit(child)) return
  signalChildGroup(child, 'SIGKILL')
  if (!(await waitForChildProcessGroupExit(child))) {
    throw new Error('Electron QA process group did not exit after SIGKILL.')
  }
}

export function observeElectronQaChildExit(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  if (child.signalCode !== null) return Promise.resolve(1)
  return new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}
