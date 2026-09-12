import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { vi } from 'vitest'
import { observeTerminalProcessExit } from '../terminal-process-exit-observation'
import type { ProcessRow } from '../terminal-process-inspector'
import type { LiveTerminalProcess, TerminalRecord } from '../terminal-records'

export const ROOT_PID = 72_001
export const CHILD_PID = 72_002
export const CLOSED_TTY = 'openwaggle-definitely-closed-test-tty'

export function row(pid: number, ppid: number, name: string): ProcessRow {
  return {
    pid,
    ppid,
    pgid: pid,
    tpgid: pid,
    tty: null,
    ttyIdentity: null,
    identityVerified: true,
    zombie: false,
    startedAt: `start-${pid}`,
    name,
  }
}

export function table(...rows: readonly ProcessRow[]) {
  return new Map(rows.map((entry) => [entry.pid, entry]))
}

export function missingProcessError() {
  return Object.assign(new Error('process is gone'), { code: 'ESRCH' })
}

export function makeSubject(processName: string) {
  const exitListeners: Array<(event: { readonly exitCode: number }) => void> = []
  let resolveTreeExit: () => void = () => undefined
  const kill = vi.fn<(signal?: string) => void>()
  const destroy = vi.fn<() => void>()
  const closeDescriptor = vi.fn<() => void>(() => {
    destroy()
    processTreeExit.notifyExit(0)
  })
  const publicDestroy = vi.fn<() => void>(() => kill('SIGHUP'))
  const pty = fromPartial<IPty>({
    pid: ROOT_PID,
    kill,
    onExit: (listener: (event: { readonly exitCode: number }) => void) => {
      exitListeners.push(listener)
      return { dispose: () => undefined }
    },
  })
  Reflect.set(pty, '_socket', { destroy })
  Reflect.set(pty, 'closeDescriptor', closeDescriptor)
  Reflect.set(pty, 'destroy', publicDestroy)
  const exit = observeTerminalProcessExit(pty)
  const processTreeExit: LiveTerminalProcess['processTreeExit'] = {
    whenExited: new Promise<void>((resolve) => {
      resolveTreeExit = resolve
    }),
    exitCode: null,
    notifyExit: (exitCode: unknown) => {
      if (processTreeExit.exitCode !== null) return
      processTreeExit.exitCode = typeof exitCode === 'number' ? exitCode : -1
      resolveTreeExit()
    },
    dispose: () => undefined,
  }
  const live: LiveTerminalProcess = {
    pty,
    pid: ROOT_PID,
    pauseOutput: vi.fn(),
    resumeOutput: vi.fn(),
    tty: CLOSED_TTY,
    ttyIdentity: null,
    processIdentity: { pid: ROOT_PID, startedAt: `start-${ROOT_PID}` },
    processMetadata: Promise.resolve({
      pid: ROOT_PID,
      startedAt: `start-${ROOT_PID}`,
      tty: CLOSED_TTY,
      ttyIdentity: null,
    }),
    exit,
    processTreeExit,
    resourceDrain: {
      status: 'drained',
      whenDrained: Promise.resolve(true),
    },
    outputPaused: false,
  }
  const record = fromPartial<TerminalRecord>({
    live,
    drainingProcesses: new Set(),
    termination: null,
    spawnGeneration: 1,
    promptDetector: null,
    exitCode: null,
    activity: {
      processNames: [processName],
      ports: [],
      processPids: [ROOT_PID, CHILD_PID],
      processIdentities: [ROOT_PID, CHILD_PID].map((pid) => ({
        pid,
        startedAt: `start-${pid}`,
      })),
      tty: CLOSED_TTY,
      processReliable: true,
      reliable: true,
    },
    pendingOutputBytes: 0,
    inFlightOutput: null,
  })
  kill.mockImplementation((signal) => {
    if (signal === 'SIGHUP') {
      processTreeExit.notifyExit(0)
      for (const listener of exitListeners) listener({ exitCode: 0 })
    }
  })
  return { closeDescriptor, destroy, publicDestroy, live, record }
}
