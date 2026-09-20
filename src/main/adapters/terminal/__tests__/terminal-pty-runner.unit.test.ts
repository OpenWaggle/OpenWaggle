import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertNativeAdmissionMock,
  existingShellsMock,
  fakePty,
  getInteractiveTerminalEnvMock,
  integrationCleanupMock,
  makeRunner,
  prepareTerminalShellLaunchMock,
  ptyExitListeners,
  readProcessMetadataMock,
  resetPtyRunnerHarness,
  SPAWN_REQUEST,
  spawnMock,
  ZSH_CANDIDATE,
} from './terminal-pty-runner-test-harness'

describe('makePtyRunner', () => {
  beforeEach(resetPtyRunnerHarness)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('spawns the preferred shell with its resolved startup arguments and label', async () => {
    spawnMock.mockReturnValue(fakePty())

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    expect(outcome).toMatchObject({ ok: true, pid: 4321, shell: 'zsh', tty: 'ttys123' })
    if (!outcome.ok) throw outcome.error
    await expect(outcome.processMetadata).resolves.toEqual({
      pid: 4321,
      startedAt: 'Fri Sep 4 22:18:37 2026',
      tty: null,
    })
    expect(spawnMock).toHaveBeenCalledOnce()
    expect(spawnMock.mock.calls[0]?.slice(0, 2)).toEqual(['/bin/zsh', ['-l', '-i']])
    expect(prepareTerminalShellLaunchMock).toHaveBeenCalledWith(
      ZSH_CANDIDATE,
      expect.any(Object),
      SPAWN_REQUEST.readinessNonce,
    )
  })

  it('rejects quarantined native admission at the spawn boundary and cleans prepared shell files', async () => {
    spawnMock.mockReturnValue(fakePty())
    assertNativeAdmissionMock.mockImplementation(() => {
      throw new Error('Native ownership is quarantined')
    })
    await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: 'Native ownership is quarantined' }),
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(integrationCleanupMock).toHaveBeenCalledOnce()
  })

  it.each([null, {}, { processInfos: () => [] }])(
    'rejects an incomplete POSIX module before spawning a shell: %j',
    async (native) => {
      await expect(makeRunner(native).spawn(SPAWN_REQUEST)).resolves.toMatchObject({ ok: false })
      expect(spawnMock).not.toHaveBeenCalled()
      expect(prepareTerminalShellLaunchMock).not.toHaveBeenCalled()
    },
  )

  it.each(['spawnProcessIdentity', 'ttyIdentity', 'fd', 'onExit', '_socket'])(
    'closes a spawned PTY when reading %s fails',
    async (property) => {
      const pty = fakePty()
      const closeDescriptor = vi.fn()
      Reflect.set(pty, 'closeDescriptor', closeDescriptor)
      Object.defineProperty(pty, property, {
        configurable: true,
        get: () => {
          throw new Error('broken native getter')
        },
      })
      spawnMock.mockReturnValue(pty)
      await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({ ok: false })
      expect(closeDescriptor).toHaveBeenCalledOnce()
      expect(integrationCleanupMock).toHaveBeenCalledOnce()
    },
  )

  it('rejects a synchronous resource-drain result and closes the spawned PTY', async () => {
    const pty = fakePty()
    const closeDescriptor = vi.fn()
    Reflect.set(pty, 'closeDescriptor', closeDescriptor)
    Reflect.set(pty, 'waitForResourceDrain', () => undefined)
    spawnMock.mockReturnValue(pty)
    await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({ ok: false })
    expect(closeDescriptor).toHaveBeenCalledOnce()
  })

  it('normalizes nested device paths and rejects missing or malformed private tty values', async () => {
    spawnMock.mockReturnValueOnce(fakePty(undefined, '/dev/pts/42'))
    await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({
      ok: true,
      tty: 'pts/42',
    })

    for (const privatePtyValue of [null, 42, 'ttys123', '/tmp/ttys123', '/dev/../tmp']) {
      spawnMock.mockReturnValueOnce(fakePty(undefined, privatePtyValue))
      await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({
        ok: true,
        tty: null,
      })
    }
  })

  it('uses the bounded spawn metadata sample as the tty fallback', async () => {
    spawnMock.mockReturnValue(fakePty(undefined, null))
    readProcessMetadataMock.mockResolvedValue({
      pid: 4321,
      startedAt: 'Fri Sep 4 22:18:37 2026',
      tty: 'ttys456',
    })

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)
    if (!outcome.ok) throw outcome.error

    expect(outcome.tty).toBeNull()
    await expect(outcome.processMetadata).resolves.toMatchObject({ tty: 'ttys456' })
  })

  it('discards spawn metadata that resolves after the PTY exit', async () => {
    let resolveMetadata: (value: {
      readonly pid: number
      readonly startedAt: string
      readonly tty: string | null
    }) => void = () => undefined
    readProcessMetadataMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      }),
    )
    spawnMock.mockReturnValue(fakePty())

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)
    if (!outcome.ok) throw outcome.error
    for (const listener of ptyExitListeners) listener({ exitCode: 0 })
    resolveMetadata({ pid: 4321, startedAt: 'recycled', tty: 'ttys999' })

    await expect(outcome.processMetadata).resolves.toBeNull()
  })

  it('latches an exit that is already observable before the spawn outcome is consumed', async () => {
    const pty = fakePty()
    Reflect.set(pty, 'onExit', (listener: (event: { readonly exitCode: number }) => void) => {
      listener({ exitCode: 23 })
      return { dispose: () => undefined }
    })
    spawnMock.mockReturnValue(pty)

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)
    if (!outcome.ok) throw outcome.error
    await outcome.exit.whenExited

    expect(outcome.exit.exitCode).toBe(23)
    await expect(outcome.processMetadata).resolves.toBeNull()
    await vi.waitFor(() => expect(integrationCleanupMock).toHaveBeenCalledOnce())
  })

  it('fails closed when a backend violates the synchronous positive-pid contract', async () => {
    const pty = fakePty()
    Object.defineProperty(pty, 'pid', { configurable: true, value: 0 })
    const closeDescriptor = vi.fn()
    Reflect.set(pty, 'closeDescriptor', closeDescriptor)
    spawnMock.mockReturnValue(pty)

    await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: 'Terminal backend returned an invalid root process id.',
      }),
    })
    expect(closeDescriptor).toHaveBeenCalledOnce()
    expect(integrationCleanupMock).toHaveBeenCalledOnce()
  })

  it('fails closed and closes a Windows spawn missing the tree or resource lifecycle API', async () => {
    const platform = process.platform
    const pty = fakePty()
    const closeDescriptor = vi.fn()
    Reflect.set(pty, 'closeDescriptor', closeDescriptor)
    spawnMock.mockReturnValue(pty)
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })

    try {
      await expect(makeRunner().spawn(SPAWN_REQUEST)).resolves.toMatchObject({
        ok: false,
        error: expect.objectContaining({
          message:
            'The installed Windows terminal backend cannot prove process-tree exit and resource drain.',
        }),
      })
      expect(closeDescriptor).toHaveBeenCalledOnce()
      expect(integrationCleanupMock).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('reuses one environment snapshot while falling back only from ENOENT', async () => {
    const environment = {
      PATH: '/custom/bin:/usr/bin',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      TERM: 'xterm-256color',
    }
    getInteractiveTerminalEnvMock.mockReturnValue(environment)
    spawnMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('spawn /bin/zsh ENOENT'), { code: 'ENOENT' })
      })
      .mockReturnValueOnce(fakePty())

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    expect(outcome).toMatchObject({ ok: true, shell: 'bash' })
    expect(getInteractiveTerminalEnvMock).toHaveBeenCalledOnce()
    expect(getInteractiveTerminalEnvMock).toHaveBeenCalledWith('1.2.3-test', {})
    expect(existingShellsMock).toHaveBeenCalledWith({ environment })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0]?.[2].env).toEqual(environment)
    expect(spawnMock.mock.calls[1]?.[2].env).toEqual(environment)
    expect(prepareTerminalShellLaunchMock.mock.calls[0]?.[1]).toBe(environment)
    expect(prepareTerminalShellLaunchMock.mock.calls[1]?.[1]).toBe(environment)
    expect(integrationCleanupMock).toHaveBeenCalledOnce()
  })

  it('stops the fallback chain on a non-ENOENT spawn failure', async () => {
    const permissionError = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
    spawnMock.mockImplementation(() => {
      throw permissionError
    })

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    expect(outcome).toEqual({ ok: false, error: permissionError })
    expect(spawnMock).toHaveBeenCalledOnce()
  })

  it('takes a new environment snapshot for each independent spawn', async () => {
    const firstEnvironment = { PATH: '/first/bin', TERMINAL_CANARY: 'first' }
    const secondEnvironment = { PATH: '/second/bin', TERMINAL_CANARY: 'second' }
    getInteractiveTerminalEnvMock
      .mockReturnValueOnce(firstEnvironment)
      .mockReturnValueOnce(secondEnvironment)
    spawnMock.mockReturnValue(fakePty())
    const runner = makeRunner()

    await runner.spawn(SPAWN_REQUEST)
    await runner.spawn({ ...SPAWN_REQUEST, readinessNonce: 'second-generation-nonce' })

    expect(getInteractiveTerminalEnvMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0]?.[2].env).toEqual(firstEnvironment)
    expect(spawnMock.mock.calls[1]?.[2].env).toEqual(secondEnvironment)
  })

  it('layers stored launch overrides into each fresh environment snapshot', async () => {
    spawnMock.mockReturnValue(fakePty())
    const env = {
      OPENWAGGLE_PROJECT_ROOT: '/tmp/repo',
      T3CODE_PROJECT_ROOT: '/tmp/repo',
    }

    await makeRunner().spawn({ ...SPAWN_REQUEST, env })

    expect(getInteractiveTerminalEnvMock).toHaveBeenCalledWith('1.2.3-test', env)
  })

  it('fails after every candidate reports a missing executable', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('File not found: shell')
    })

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    expect(outcome.ok).toBe(false)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('holds the node-pty stream until attach and exposes idempotent output flow control', async () => {
    const pause = vi.fn()
    const resume = vi.fn()
    spawnMock.mockReturnValue(fakePty({ pause, resume }))

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    if (!outcome.ok) throw outcome.error
    expect(pause).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    outcome.resumeOutput()
    expect(resume).toHaveBeenCalledOnce()
    outcome.pauseOutput()
    outcome.pauseOutput()
    expect(pause).toHaveBeenCalledTimes(2)
    outcome.resumeOutput()
    outcome.resumeOutput()
    expect(resume).toHaveBeenCalledTimes(2)
  })

  it('keeps output flow controls safe when node-pty exposes no master stream', async () => {
    spawnMock.mockReturnValue(fakePty())

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    if (!outcome.ok) throw outcome.error
    expect(() => {
      outcome.pauseOutput()
      outcome.resumeOutput()
    }).not.toThrow()
  })

  it('contains private master stream flow-control failures', async () => {
    const unavailable = () => {
      throw new Error('private stream unavailable')
    }
    spawnMock.mockReturnValue(fakePty({ pause: unavailable, resume: unavailable }))

    const outcome = await makeRunner().spawn(SPAWN_REQUEST)

    if (!outcome.ok) throw outcome.error
    expect(() => {
      outcome.pauseOutput()
      outcome.resumeOutput()
    }).not.toThrow()
  })
})
