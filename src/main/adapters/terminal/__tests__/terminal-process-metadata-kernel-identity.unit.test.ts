import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalKernelProcessInfo } from '../terminal-process-identity'

const commands = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../terminal-process-command', () => ({
  runTerminalProcessCommand: commands.run,
}))

const { installTerminalProcessKernelApi, resetTerminalProcessKernelApiForTests } = await import(
  '../terminal-process-kernel-api'
)
const { readProcessMetadata } = await import('../terminal-process-probes')

const PID = 42

function kernelInfo(startedAt: string, ttyIdentity: string): TerminalKernelProcessInfo {
  return {
    pid: PID,
    startedAt,
    ppid: 1,
    pgid: PID,
    tpgid: PID,
    ttyIdentity,
    zombie: false,
    name: 'zsh',
  }
}

function installObservations(...observations: readonly TerminalKernelProcessInfo[]) {
  let index = 0
  const processInfos = vi.fn(() => {
    const observation = observations[index]
    index += 1
    return observation === undefined ? [] : [observation]
  })
  const pty = fromPartial<typeof NodePtyModule>({})
  Reflect.set(pty, 'native', { processInfos })
  installTerminalProcessKernelApi(pty)
  return processInfos
}

describe('spawn process metadata kernel identity', () => {
  beforeEach(() => {
    commands.run.mockReset()
    commands.run.mockResolvedValue({
      ok: true,
      output: 'ttys001\n',
      errorOutput: '',
      exitCode: null,
    })
  })

  afterEach(() => {
    resetTerminalProcessKernelApiForTests()
    vi.restoreAllMocks()
  })

  it('rejects reused tty text when the kernel tty identity changes during the probe', async () => {
    installObservations(
      kernelInfo('darwin:start:42', 'darwin:16:1'),
      kernelInfo('darwin:start:42', 'darwin:16:2'),
    )

    await expect(readProcessMetadata(PID)).resolves.toBeNull()
    expect(commands.run).toHaveBeenCalledOnce()
  })

  it('rejects a process whose kernel birth token changes during the probe', async () => {
    installObservations(
      kernelInfo('darwin:start:42', 'darwin:16:1'),
      kernelInfo('darwin:start:reused', 'darwin:16:1'),
    )

    await expect(readProcessMetadata(PID)).resolves.toBeNull()
    expect(commands.run).toHaveBeenCalledOnce()
  })

  it.each([
    ['birth token', 'darwin:start:other', 'darwin:16:1'],
    ['tty identity', 'darwin:start:42', 'darwin:16:2'],
  ])(
    'fails before ps when the expected %s does not match',
    async (_case, startedAt, ttyIdentity) => {
      installObservations(kernelInfo('darwin:start:42', 'darwin:16:1'))

      await expect(readProcessMetadata(PID, 25, startedAt, ttyIdentity)).resolves.toBeNull()
      expect(commands.run).not.toHaveBeenCalled()
    },
  )
})
