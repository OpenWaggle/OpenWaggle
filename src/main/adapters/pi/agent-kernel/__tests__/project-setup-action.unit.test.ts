import type { TerminalOpenInput } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalServiceShape } from '../../../../ports/terminal-service'
import { launchProjectSetupAction } from '../project-setup-action'

const ATTACH_RESULT = {
  history: '',
  outputBytes: 0,
  outputGeneration: 1,
  readiness: { phase: 'spawning' as const, generation: 1 },
  running: true,
  processName: null,
  ports: [],
  projectActionPending: false,
}

const SETUP_ACTION = {
  id: 'install-deps',
  name: 'Install dependencies',
  command: 'pnpm install',
  icon: 'configure' as const,
  runOnWorktreeCreate: true,
}

const openMock = vi.fn<TerminalServiceShape['open']>((_input: TerminalOpenInput) =>
  Effect.succeed(ATTACH_RESULT),
)
const writeMock = vi.fn<TerminalServiceShape['write']>(
  (
    _ownerKey: string,
    _terminalId: string,
    data: string,
    _identity?: { readonly generation: string; readonly sequence: number },
  ) => Effect.succeed({ status: 'queued' as const, acceptedBytes: data.length }),
)
const closeMock = vi.fn<TerminalServiceShape['close']>(() => Effect.void)

function terminal() {
  return fromPartial<TerminalServiceShape>({ open: openMock, write: writeMock, close: closeMock })
}

function launch(
  listActions: NonNullable<Parameters<typeof launchProjectSetupAction>[0]['listActions']>,
  onTerminalOpened = vi.fn(),
  signal?: AbortSignal,
) {
  return launchProjectSetupAction({
    sessionId: 'session-1',
    primaryPath: '/project',
    worktreePath: '/worktree',
    setupGeneration: 'generation-1',
    terminal: terminal(),
    listActions,
    onTerminalOpened,
    ...(signal ? { signal } : {}),
  })
}

describe('launchProjectSetupAction', () => {
  beforeEach(() => {
    openMock.mockReset().mockImplementation(() => Effect.succeed(ATTACH_RESULT))
    writeMock
      .mockReset()
      .mockImplementation((_ownerKey, _terminalId, data) =>
        Effect.succeed({ status: 'queued' as const, acceptedBytes: data.length }),
      )
    closeMock.mockReset().mockImplementation(() => Effect.void)
  })

  it('does nothing when the project has no Setup action', async () => {
    await expect(launch(async () => [])).resolves.toEqual({ status: 'no-action' })

    expect(openMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('opens a session-owned terminal and queues the command with a generation identity', async () => {
    const onTerminalOpened = vi.fn()

    await expect(launch(async () => [SETUP_ACTION], onTerminalOpened)).resolves.toEqual({
      status: 'started',
      setupAction: {
        terminalId: 'setup-install-deps',
        actionId: 'install-deps',
        actionName: 'Install dependencies',
        projectRoot: '/project',
        cwd: '/worktree',
      },
    })

    expect(openMock).toHaveBeenCalledWith({
      ownerKey: 'session-1',
      terminalId: 'setup-install-deps',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
      inputGeneration: 'setup-install-deps',
      env: {
        OPENWAGGLE_PROJECT_ROOT: '/project',
        OPENWAGGLE_WORKTREE_PATH: '/worktree',
        T3CODE_PROJECT_ROOT: '/project',
        T3CODE_WORKTREE_PATH: '/worktree',
      },
    })
    expect(onTerminalOpened).toHaveBeenCalledBefore(writeMock)
    expect(writeMock).toHaveBeenCalledWith(
      'session-1',
      'setup-install-deps',
      'pnpm install\r',
      { generation: 'setup-install-deps', sequence: 0 },
      {
        kind: 'project-action',
        executionId: 'setup:generation-1:install-deps',
      },
    )
  })

  it('reports metadata only after open acceptance and rejects a refused write', async () => {
    const onTerminalOpened = vi.fn()
    writeMock.mockImplementation(() =>
      Effect.succeed({
        status: 'rejected' as const,
        acceptedBytes: 0 as const,
        reason: 'queue-full',
      }),
    )

    await expect(launch(async () => [SETUP_ACTION], onTerminalOpened)).rejects.toThrow(
      /command was rejected \(queue-full\)/,
    )
    expect(onTerminalOpened).toHaveBeenCalledOnce()
    expect(closeMock).toHaveBeenCalledWith('session-1', 'setup-install-deps', true)
  })

  it('does not report metadata when the terminal open was not accepted', async () => {
    const onTerminalOpened = vi.fn()
    openMock.mockImplementation(() => Effect.succeed({ ...ATTACH_RESULT, running: false }))

    await expect(launch(async () => [SETUP_ACTION], onTerminalOpened)).rejects.toThrow(
      /terminal did not open/,
    )
    expect(onTerminalOpened).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('delivers the largest multibyte command as one atomic action item', async () => {
    const command = '🦭'.repeat(8_192)

    await launch(async () => [{ ...SETUP_ACTION, command }])

    const writes = writeMock.mock.calls
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[2]).toBe(`${command}\r`)
    expect(Buffer.byteLength(writes[0]?.[2] ?? '', 'utf8')).toBe(32_769)
    expect(writes[0]?.[3]).toEqual({ generation: 'setup-install-deps', sequence: 0 })
    expect(writes[0]?.[4]).toEqual({
      kind: 'project-action',
      executionId: 'setup:generation-1:install-deps',
    })
  })

  it('closes an accepted terminal when cancellation wins before command delivery', async () => {
    const controller = new AbortController()
    const onTerminalOpened = vi.fn(() => controller.abort(new Error('session archived')))

    await expect(
      launch(async () => [SETUP_ACTION], onTerminalOpened, controller.signal),
    ).rejects.toThrow('session archived')

    expect(openMock).toHaveBeenCalledOnce()
    expect(writeMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalledWith('session-1', 'setup-install-deps', true)
  })

  it('treats main acceptance as dispatched when cancellation settles during the write', async () => {
    const controller = new AbortController()
    writeMock.mockImplementation((_ownerKey, _terminalId, data) => {
      controller.abort(new Error('session archived after dispatch'))
      return Effect.succeed({ status: 'queued' as const, acceptedBytes: data.length })
    })

    await expect(
      launch(async () => [SETUP_ACTION], vi.fn(), controller.signal),
    ).resolves.toMatchObject({ status: 'started' })

    expect(writeMock).toHaveBeenCalledOnce()
    expect(closeMock).not.toHaveBeenCalled()
  })

  it('does not open a terminal when cancellation settles during action lookup', async () => {
    const controller = new AbortController()
    let resolveActions: ((actions: readonly (typeof SETUP_ACTION)[]) => void) | undefined
    const actions = new Promise<readonly (typeof SETUP_ACTION)[]>((resolve) => {
      resolveActions = resolve
    })
    const launching = launch(() => actions, vi.fn(), controller.signal)

    controller.abort(new Error('session deleted'))
    resolveActions?.([SETUP_ACTION])

    await expect(launching).rejects.toThrow('session deleted')
    expect(openMock).not.toHaveBeenCalled()
    expect(closeMock).not.toHaveBeenCalled()
  })
})
