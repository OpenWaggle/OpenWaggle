import fs from 'node:fs/promises'
import path from 'node:path'
import type { StoppableChild } from './child-process-lifecycle'

const LOCK_DENIED_MARKER_FILE = 'automation-single-instance-lock-denied'
const LOCK_DENIED_MARKER_SWITCH = 'openwaggle-automation-single-instance-lock-denied-marker'
const LOCK_DENIED_MARKER_CONTENT = 'single-instance-lock-denied\n'
const SECOND_INSTANCE_EXIT_TIMEOUT_MS = 10_000

function normalExitFailure(code: number | null, signal: NodeJS.Signals | null) {
  if (code === 0) return null
  if (code !== null) {
    return new Error(`The second packaged GUI exited with code ${String(code)}.`)
  }
  if (signal !== null) {
    return new Error(`The second packaged GUI exited from signal ${signal}.`)
  }
  return new Error('The second packaged GUI exit status was unavailable.')
}

export async function waitForNormalSecondInstanceExit(
  child: StoppableChild,
  timeoutMs = SECOND_INSTANCE_EXIT_TIMEOUT_MS,
) {
  const immediateFailure = normalExitFailure(child.exitCode, child.signalCode)
  if (child.exitCode !== null || child.signalCode !== null) {
    if (immediateFailure !== null) throw immediateFailure
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      const failure = normalExitFailure(code, signal)
      if (failure === null) resolve()
      else reject(failure)
    }
    const timer = setTimeout(() => {
      settled = true
      child.off('exit', onExit)
      reject(new Error('A second packaged GUI acquired the single-instance lock.'))
    }, timeoutMs)
    child.once('exit', onExit)
    // The process can exit between the initial status check and listener registration.
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode)
    }
  })
}

export function singleInstanceLockDeniedMarkerPath(userDataRoot: string) {
  return path.join(userDataRoot, LOCK_DENIED_MARKER_FILE)
}

export function singleInstanceLockDeniedArguments(markerPath: string) {
  return [`--${LOCK_DENIED_MARKER_SWITCH}=${markerPath}`]
}

export async function assertSingleInstanceLockDeniedMarker(markerPath: string) {
  let contents: string
  try {
    contents = await fs.readFile(markerPath, 'utf8')
  } catch (error) {
    throw new Error('The second packaged GUI did not prove single-instance lock denial.', {
      cause: error,
    })
  }
  if (contents !== LOCK_DENIED_MARKER_CONTENT) {
    throw new Error('The second packaged GUI wrote an invalid single-instance lock-denied marker.')
  }
}
