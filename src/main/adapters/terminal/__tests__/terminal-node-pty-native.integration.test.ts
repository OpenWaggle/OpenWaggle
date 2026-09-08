import type { IPty } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInteractiveTerminalEnv } from '../../../env'
import { createNativeTtyMemberSignal } from '../terminal-pty-native-signal'

const READY_MARKER = '__OPENWAGGLE_NATIVE_READY__:'
const HUP_MARKER = '__OPENWAGGLE_NATIVE_HUP__'
const CLOSE_READY_MARKER = '__OPENWAGGLE_CLOSE_READY__'
const TEST_TIMEOUT_MS = 10_000
const WINDOWS_CLOSE_GATE_MS = 250

type DescriptorPty = IPty & { readonly closeDescriptor?: () => void }

function nativeIdentity(pty: DescriptorPty, property: 'spawnProcessIdentity' | 'ttyIdentity') {
  const value: unknown = Reflect.get(pty, property)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Patched node-pty did not expose ${property}.`)
  }
  return value
}

let spawned: DescriptorPty | null = null
let signalTtyMembers: ((force: boolean) => number | null) | undefined

afterEach(async () => {
  if (spawned === null) return
  signalTtyMembers?.(true)
  spawned.closeDescriptor?.()
  await waitForPidAbsence(spawned.pid, 1_000)
  spawned = null
  signalTtyMembers = undefined
  vi.restoreAllMocks()
})

describe.runIf(process.platform === 'darwin')('Darwin node-pty shutdown integration', () => {
  it('signals an exact tty root and background job once through the patched native export', async () => {
    const pty = await import('node-pty')
    spawned = pty.spawn(
      '/bin/sh',
      [
        '-c',
        `trap 'printf "${HUP_MARKER}\\n"; exit 0' HUP; sleep 30 & child_pid=$!; printf '${READY_MARKER}%s\\n' "$child_pid"; read hold`,
      ],
      terminalOptions(),
    )
    signalTtyMembers = createNativeTtyMemberSignal(
      pty,
      spawned,
      nativeIdentity(spawned, 'ttyIdentity'),
      nativeIdentity(spawned, 'spawnProcessIdentity'),
    )
    expect(signalTtyMembers).toBeTypeOf('function')

    const output = createOutputCapture(spawned)
    const exit = waitForPtyExit(spawned)
    const readyOutput = await output.until(READY_MARKER)
    const childPid = Number(readyOutput.match(new RegExp(`${READY_MARKER}(\\d+)`))?.[1])
    expect(Number.isInteger(childPid)).toBe(true)

    const signaledCount = signalTtyMembers?.(false)
    expect(signaledCount).not.toBeNull()
    expect(signaledCount).toBeGreaterThanOrEqual(2)
    await exit
    await expect(waitForPidAbsence(childPid, 2_000)).resolves.toBe(true)

    expect(output.value().split(HUP_MARKER)).toHaveLength(2)
    output.dispose()
  })

  it('quiesces an in-flight raw descriptor write before closing the PTY', async () => {
    const pty = await import('node-pty')
    spawned = pty.spawn(
      '/bin/sh',
      ['-c', `printf '${CLOSE_READY_MARKER}\\n'; exec /bin/cat`],
      terminalOptions(),
    )
    signalTtyMembers = createNativeTtyMemberSignal(
      pty,
      spawned,
      nativeIdentity(spawned, 'ttyIdentity'),
      nativeIdentity(spawned, 'spawnProcessIdentity'),
    )
    const output = createOutputCapture(spawned)
    await output.until(CLOSE_READY_MARKER)
    output.dispose()
    const exit = waitForPtyExit(spawned)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    spawned.write('x'.repeat(4 * 1024 * 1024))
    spawned.closeDescriptor?.()
    await exit

    expect(consoleError).not.toHaveBeenCalledWith(
      'Unhandled pty write error',
      expect.objectContaining({ code: 'EBADF' }),
    )
  })
})

describe.runIf(process.platform === 'win32')('Windows node-pty shutdown integration', () => {
  it('closes ConPTY idempotently without a delayed process-list kill', async () => {
    const pty = await import('node-pty')
    spawned = pty.spawn(
      'cmd.exe',
      ['/d', '/s', '/c', `echo ${CLOSE_READY_MARKER} && ping -n 30 127.0.0.1 >nul`],
      terminalOptions(),
    )
    const output = createOutputCapture(spawned)
    await output.until(CLOSE_READY_MARKER)
    output.dispose()
    const exit = waitForPtyExit(spawned)
    expect(spawned.closeDescriptor).toBeTypeOf('function')

    const startedAt = performance.now()
    spawned.closeDescriptor?.()
    spawned.closeDescriptor?.()
    await exit

    expect(performance.now() - startedAt).toBeLessThanOrEqual(WINDOWS_CLOSE_GATE_MS)
  })
})

function terminalOptions() {
  return {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env:
      process.platform === 'win32'
        ? getInteractiveTerminalEnv('node-pty-integration')
        : { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
  }
}

function createOutputCapture(pty: IPty) {
  let output = ''
  const data = pty.onData((chunk) => {
    output += chunk
  })
  return {
    value: () => output,
    until: async (marker: string) => {
      const deadline = Date.now() + TEST_TIMEOUT_MS
      while (!output.includes(marker)) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${marker}.`)
        await delay(5)
      }
      return output
    },
    dispose: () => data.dispose(),
  }
}

function waitForPtyExit(pty: IPty) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for PTY ${pty.pid} to exit.`)),
      TEST_TIMEOUT_MS,
    )
    pty.onExit(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function waitForPidAbsence(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (pid > 0 && processIsAlive(pid)) {
    if (Date.now() >= deadline) return false
    await delay(5)
  }
  return true
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
