import os from 'node:os'
import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePtyRunner, type PtySpawnRequest } from '../terminal-pty-runner'

const spawnMock = vi.hoisted(() =>
  vi.fn<(file: string, args: string[], options: object) => NodePtyModule.IPty>(),
)

vi.mock('node-pty', () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}))

function fakePty() {
  return fromPartial<NodePtyModule.IPty>({
    pid: 4321,
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  })
}

describe('makePtyRunner', () => {
  afterEach(() => {
    spawnMock.mockReset()
    vi.restoreAllMocks()
  })

  it('spawns the first existing shell as a login shell on darwin and reports its name', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const pty = fakePty()
    spawnMock.mockReturnValue(pty)
    const runner = makePtyRunner(async () =>
      fromPartial<typeof NodePtyModule>({ spawn: spawnMock }),
    )

    const outcome = await runner.spawn({
      cwd: '/tmp/repo',
      cols: 100,
      rows: 28,
    } satisfies PtySpawnRequest)

    expect(outcome).toMatchObject({ ok: true, pid: 4321, shell: 'zsh' })
    expect(spawnMock).toHaveBeenCalledOnce()
    const [shell, args] = spawnMock.mock.calls[0] ?? []
    expect(shell).toBe('/bin/zsh')
    expect(args).toEqual(['-l'])
  })

  it('spawns without login args off darwin', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    const pty = fakePty()
    spawnMock.mockReturnValue(pty)
    const runner = makePtyRunner(async () =>
      fromPartial<typeof NodePtyModule>({ spawn: spawnMock }),
    )

    await runner.spawn({ cwd: '/tmp/repo', cols: 100, rows: 28 } satisfies PtySpawnRequest)

    expect(spawnMock.mock.calls[0]?.[1]).toEqual([])
  })

  it('falls back down the shell chain and fails when nothing spawns', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    spawnMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const runner = makePtyRunner(async () =>
      fromPartial<typeof NodePtyModule>({ spawn: spawnMock }),
    )

    const outcome = await runner.spawn({
      cwd: '/tmp/repo',
      cols: 100,
      rows: 28,
    } satisfies PtySpawnRequest)

    expect(outcome.ok).toBe(false)
    expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
