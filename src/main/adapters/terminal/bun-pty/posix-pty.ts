import { constants as osConstants } from 'node:os'
import { spawnWithTerminal, type BunSubprocess, type BunTerminal } from '../../bun/bun-runtime'
import type { Pty, PtyExitEvent, PtySpawnOptions } from '../terminal-pty-backend'
import { ptyEvent, ptyOutput } from './pty-output'
import { type PosixKernel, registerTerminalHandle, releaseTerminalHandle } from './posix-kernel'

/**
 * A POSIX pseudo-terminal on `Bun.spawn({ terminal })` (ADR 0030, ADR 0064), with the members
 * the terminal runtime reads from its backend: the root's birth identity and the tty's device
 * identity captured right after spawn, a handle for `signalByTty` (`fd`), the slave's path
 * (`_pty`), descriptor close, resource drain, and output pause (`_socket`).
 *
 * Exit is reported as node-pty did: after the PTY reports end of file, or 200 ms after the root
 * exited, when the master is closed so background jobs get their hangup.
 */
const DESTROY_AFTER_EXIT_MS = 200
const IDENTITY_CAPTURE_ATTEMPTS = 20
const IDENTITY_CAPTURE_WAIT_MS = 2
const SIGNAL_EXIT_BASE = 128

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms)
}

/**
 * The root's identity and its controlling tty, once the child has acquired it. A root that
 * already exited and was reaped gets an identity no process can have: nothing is ever signaled
 * through it, and the runtime reads the root as exited.
 */
function captureIdentity(kernel: PosixKernel, pid: number) {
  for (let attempt = 0; attempt < IDENTITY_CAPTURE_ATTEMPTS; attempt += 1) {
    const [info] = kernel.processInfos([pid])
    if (!info) {
      return { processIdentity: `exited:${String(pid)}`, ttyIdentity: `exited:${String(pid)}` }
    }
    if (info.ttyIdentity !== null) {
      return { processIdentity: info.startedAt, ttyIdentity: info.ttyIdentity }
    }
    sleepSync(IDENTITY_CAPTURE_WAIT_MS)
  }
  throw new Error('Could not capture the spawned process and PTY identities.')
}

function exitEvent(subprocess: BunSubprocess, code: number) {
  const signalName = subprocess.signalCode
  const signal: unknown =
    signalName !== null && signalName in osConstants.signals
      ? Reflect.get(osConstants.signals, signalName)
      : undefined
  if (typeof signal === 'number') return { exitCode: 0, signal } satisfies PtyExitEvent
  return {
    exitCode: subprocess.exitCode ?? (code >= SIGNAL_EXIT_BASE ? 1 : code),
  } satisfies PtyExitEvent
}

export interface PosixPty extends Pty {
  readonly fd: number
  readonly _pty: string | null
  readonly spawnProcessIdentity: string
  readonly ttyIdentity: string
  readonly _socket: { readonly pause: () => void; readonly resume: () => void }
  readonly closeDescriptor: () => void
  readonly waitForResourceDrain: () => Promise<void>
  readonly kill: (signal?: string) => void
}

export function spawnPosixPty(
  kernel: PosixKernel,
  file: string,
  args: readonly string[],
  options: PtySpawnOptions,
) {
  const output = ptyOutput()
  const exit = ptyEvent<PtyExitEvent>()
  const state: { eof: boolean; closed: boolean; exited: PtyExitEvent | null; emitted: boolean } = {
    eof: false,
    closed: false,
    exited: null,
    emitted: false,
  }
  let resolveDrain: () => void = () => undefined
  const drained = new Promise<void>((resolve) => {
    resolveDrain = resolve
  })
  const settle = () => {
    if (state.exited === null || !(state.eof || state.closed)) return
    if (!state.emitted) {
      state.emitted = true
      output.flush()
      exit.emit(state.exited)
    }
    resolveDrain()
  }
  const terminalRef: { current: BunTerminal | null } = { current: null }
  const closeTerminal = () => {
    if (state.closed) return
    state.closed = true
    terminalRef.current?.close()
    settle()
  }
  const subprocess = spawnWithTerminal([file, ...args], {
    cwd: options.cwd,
    env: { ...options.env, TERM: options.name },
    terminal: {
      cols: options.cols,
      rows: options.rows,
      name: options.name,
      data: (_terminal, bytes) => output.push(bytes),
      exit: () => {
        state.eof = true
        settle()
      },
    },
  })
  const terminal = subprocess.terminal
  if (!terminal) throw new Error('Bun did not attach a terminal to the spawned process.')
  terminalRef.current = terminal
  let identity: ReturnType<typeof captureIdentity>
  try {
    identity = captureIdentity(kernel, subprocess.pid)
  } catch (error) {
    terminal.close()
    throw error
  }
  const handle = registerTerminalHandle(() => (state.closed ? null : identity.ttyIdentity))
  void subprocess.exited.then((code) => {
    state.exited = exitEvent(subprocess, code)
    settle()
    if (!state.emitted) setTimeout(closeTerminal, DESTROY_AFTER_EXIT_MS)
  })
  void drained.then(() => releaseTerminalHandle(handle))
  return {
    pid: subprocess.pid,
    fd: handle,
    _pty: kernel.ttyPath(subprocess.pid),
    spawnProcessIdentity: identity.processIdentity,
    ttyIdentity: identity.ttyIdentity,
    onData: output.onData,
    onExit: exit.add,
    write: (text) => {
      if (!state.closed) terminal.write(text)
    },
    resize: (cols, rows) => {
      if (!state.closed) terminal.resize(cols, rows)
    },
    clear: () => undefined,
    // The identity-bound signal: a recycled pid is never signaled.
    kill: (signal = 'SIGHUP') => {
      const number: unknown = Reflect.get(osConstants.signals, signal)
      if (typeof number === 'number') {
        kernel.signalProcess(subprocess.pid, identity.processIdentity, number)
      }
    },
    pause: output.pause,
    resume: output.resume,
    _socket: { pause: output.pause, resume: output.resume },
    closeDescriptor: closeTerminal,
    waitForResourceDrain: () => drained,
  } satisfies PosixPty
}
