import type { ProjectAction } from '@shared/types/project-actions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalGroupState, TerminalProjectActionEnqueueResult } from '@/features/terminal'
import {
  executeProjectAction,
  type ProjectActionRunDependencies,
  projectActionLaunchEnvironment,
} from '../project-action-runner'

const OWNER = 'session-1'
const TERMINAL_ID = 'terminal-1'
const ACTION: ProjectAction = {
  id: 'action-test',
  name: 'Test',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
  previewUrl: 'http://localhost:5173/',
  autoOpenPreview: true,
}

function group(cwd: string, launchEnv?: Readonly<Record<string, string>>): TerminalGroupState {
  return {
    tabs: [
      {
        id: 'tab-1',
        panes: [
          {
            terminalId: TERMINAL_ID,
            cwd,
            ...(launchEnv === undefined ? {} : { launchEnv }),
          },
        ],
        activePaneId: TERMINAL_ID,
        splitDirection: 'side-by-side',
        customName: null,
      },
    ],
    activeTabId: 'tab-1',
    panelOpen: false,
    panelHeight: 320,
  }
}

function dependencies(input: {
  readonly activity: 'idle' | 'running' | 'unknown'
  readonly cwd?: string
  readonly launchEnv?: Readonly<Record<string, string>>
  readonly projectActionPending?: boolean
  readonly pendingInputAction?: boolean
  readonly responses?: readonly TerminalProjectActionEnqueueResult[]
}) {
  const calls: string[] = []
  const executionIds: string[] = []
  const groups = { [OWNER]: group(input.cwd ?? '/project', input.launchEnv) }
  const responses = [...(input.responses ?? [{ status: 'accepted' as const }])]
  const deps: ProjectActionRunDependencies = {
    terminalSnapshot: () => ({
      groups,
      exits: {},
    }),
    resolveLayoutOwner: () => OWNER,
    getActivityStatus: () => input.activity,
    getProjectActionPending: () => input.projectActionPending ?? false,
    hasPendingInputAction: () => input.pendingInputAction ?? false,
    createTerminal: (_ownerKey, _cwd, launchEnv) => {
      calls.push(`create:${JSON.stringify(launchEnv)}`)
      return 'terminal-new'
    },
    setPaneLaunchEnv: (_ownerKey, _terminalId, launchEnv) => {
      calls.push(`env:${JSON.stringify(launchEnv)}`)
    },
    setPanelOpen: () => calls.push('panel'),
    showSideTerminal: () => calls.push('side'),
    acquireInput: (_ownerKey, terminalId) => {
      calls.push(`acquire:${terminalId}`)
      return {
        enqueueProjectAction: async (data, executionId) => {
          calls.push(`enqueue:${data}`)
          executionIds.push(executionId)
          return responses.shift() ?? { status: 'accepted' }
        },
        markUnavailable: () => calls.push('unavailable'),
        release: () => calls.push('release'),
      }
    },
    openPreview: async (_ownerKey, url) => {
      calls.push(`preview:${url}`)
    },
  }
  return { calls, deps, executionIds }
}

describe('project action runner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('reuses only a confidently idle pane and queues after its launch context changes', async () => {
    const harness = dependencies({
      activity: 'idle',
      cwd: '/project/.worktrees/session-1',
    })
    const result = await executeProjectAction(
      ACTION,
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project/.worktrees/session-1',
        worktreeMode: true,
      },
      harness.deps,
    )

    expect(result).toEqual({ terminalId: TERMINAL_ID, reused: true, previewError: null })
    expect(harness.calls).toEqual([
      'panel',
      `acquire:${TERMINAL_ID}`,
      'unavailable',
      'env:{"OPENWAGGLE_PROJECT_ROOT":"/project","OPENWAGGLE_WORKTREE_PATH":"/project/.worktrees/session-1","T3CODE_PROJECT_ROOT":"/project","T3CODE_WORKTREE_PATH":"/project/.worktrees/session-1"}',
      'enqueue:pnpm test\r',
      'release',
      'preview:http://localhost:5173/',
    ])
  })

  it('does not reuse a just-commanded terminal while its idle activity snapshot is stale', async () => {
    const harness = dependencies({
      activity: 'idle',
      launchEnv: projectActionLaunchEnvironment('/project', '/project', false),
      responses: [
        { status: 'accepted' },
        {
          status: 'rejected',
          reason: 'project-action-pending',
          error: 'Another Project Action is already pending in this terminal.',
        },
        { status: 'accepted' },
      ],
    })
    const context = {
      projectPath: '/project',
      ownerKey: OWNER,
      workingPath: '/project',
      worktreeMode: false,
    } as const
    const action = { ...ACTION, previewUrl: undefined, autoOpenPreview: undefined }

    const first = await executeProjectAction(action, context, harness.deps)
    const second = await executeProjectAction(action, context, harness.deps)

    expect(first).toMatchObject({ terminalId: TERMINAL_ID, reused: true })
    expect(second).toMatchObject({ terminalId: 'terminal-new', reused: false })
    expect(harness.calls.filter((call) => call.startsWith('create:'))).toHaveLength(1)
    expect(harness.calls).toContain('acquire:terminal-new')
    expect(harness.executionIds[1]).toBe(harness.executionIds[2])
  })

  it.each([
    ['unknown', 'unknown'],
    ['busy', 'running'],
  ] as const)('opens a new terminal when activity is %s', async (_label, activity) => {
    const harness = dependencies({ activity })
    const result = await executeProjectAction(
      { ...ACTION, previewUrl: undefined, autoOpenPreview: undefined },
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project',
        worktreeMode: false,
      },
      harness.deps,
    )

    expect(result).toMatchObject({ terminalId: 'terminal-new', reused: false })
    expect(harness.calls[0]).toContain('create:')
    expect(harness.calls).toContain('acquire:terminal-new')
    expect(harness.calls).not.toContain('unavailable')
  })

  it.each([
    ['main barrier', { projectActionPending: true }],
    ['local ordered queue', { pendingInputAction: true }],
  ] as const)('opens a new terminal when the %s already has an action', async (_label, state) => {
    const harness = dependencies({ activity: 'idle', ...state })

    const result = await executeProjectAction(
      { ...ACTION, previewUrl: undefined, autoOpenPreview: undefined },
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project',
        worktreeMode: false,
      },
      harness.deps,
    )

    expect(result).toMatchObject({ terminalId: 'terminal-new', reused: false })
    expect(harness.calls[0]).toContain('create:')
  })

  it('opens a new terminal when the idle pane is outside the active Working path', async () => {
    const harness = dependencies({ activity: 'idle', cwd: '/project' })

    const result = await executeProjectAction(
      { ...ACTION, previewUrl: undefined, autoOpenPreview: undefined },
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project/.worktrees/session-1',
        worktreeMode: true,
      },
      harness.deps,
    )

    expect(result).toMatchObject({ terminalId: 'terminal-new', reused: false })
    expect(harness.calls[0]).toContain('create:')
    expect(harness.calls).toContain('acquire:terminal-new')
  })

  it('does not open a preview when the exact-once queue rejects the command', async () => {
    const harness = dependencies({
      activity: 'idle',
      responses: [{ status: 'rejected', reason: 'inactive', error: 'terminal unavailable' }],
    })

    await expect(
      executeProjectAction(
        ACTION,
        {
          projectPath: '/project',
          ownerKey: OWNER,
          workingPath: '/project',
          worktreeMode: false,
        },
        harness.deps,
      ),
    ).rejects.toThrow('terminal unavailable')
    expect(harness.calls).toContain('release')
    expect(harness.calls).not.toContain('preview:http://localhost:5173/')
  })

  it('reports preview failure without turning an accepted command into a failed run', async () => {
    const harness = dependencies({
      activity: 'idle',
      launchEnv: projectActionLaunchEnvironment('/project', '/project', false),
    })
    const deps = {
      ...harness.deps,
      openPreview: vi.fn().mockRejectedValue(new Error('browser unavailable')),
    }

    const result = await executeProjectAction(
      ACTION,
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project',
        worktreeMode: false,
      },
      deps,
    )

    expect(result.previewError?.message).toBe('browser unavailable')
  })

  it('opens the preview only after main acknowledges the whole action command', async () => {
    const harness = dependencies({ activity: 'idle' })
    let acknowledge: (result: TerminalProjectActionEnqueueResult) => void = () => undefined
    const enqueueProjectAction = vi.fn(
      () =>
        new Promise<TerminalProjectActionEnqueueResult>((resolve) => {
          acknowledge = resolve
        }),
    )
    const openPreview = vi.fn(async () => undefined)
    const running = executeProjectAction(
      ACTION,
      {
        projectPath: '/project',
        ownerKey: OWNER,
        workingPath: '/project',
        worktreeMode: false,
      },
      {
        ...harness.deps,
        acquireInput: () => ({
          enqueueProjectAction,
          markUnavailable: vi.fn(),
          release: vi.fn(),
        }),
        openPreview,
      },
    )

    expect(enqueueProjectAction).toHaveBeenCalledOnce()
    expect(openPreview).not.toHaveBeenCalled()
    acknowledge({ status: 'accepted' })
    await expect(running).resolves.toMatchObject({ previewError: null })
    expect(openPreview).toHaveBeenCalledWith(OWNER, ACTION.previewUrl)
  })

  it('sets compatibility and native roots, adding worktree variables only in worktree mode', () => {
    expect(projectActionLaunchEnvironment('/project', '/project', false)).toEqual({
      OPENWAGGLE_PROJECT_ROOT: '/project',
      T3CODE_PROJECT_ROOT: '/project',
    })
    expect(projectActionLaunchEnvironment('/project', '/worktree', true)).toEqual({
      OPENWAGGLE_PROJECT_ROOT: '/project',
      OPENWAGGLE_WORKTREE_PATH: '/worktree',
      T3CODE_PROJECT_ROOT: '/project',
      T3CODE_WORKTREE_PATH: '/worktree',
    })
  })
})
