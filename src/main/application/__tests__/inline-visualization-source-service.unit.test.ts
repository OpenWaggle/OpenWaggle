import { SessionId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { resolveLocalSessionHostPaths } from '../../session-host/local-session-paths'
import {
  configureGuiSessionCommandClient,
  retireGuiSessionCommandClientForUpgrade,
} from '../gui-session-command-router'
import { readInlineVisualizationSource } from '../inline-visualization-source-service'
import { emptySessionCatalogMethods } from './session-repository-test-support'

const { executeConfiguredHostUi } = vi.hoisted(() => ({ executeConfiguredHostUi: vi.fn() }))
vi.mock('../configured-host-ui-client', () => ({ executeConfiguredHostUi }))

const sessionId = SessionId('visualization-worktree-session')
const ownerSession = {
  id: sessionId,
  title: 'Worktree visualization',
  projectPath: '/opened-checkout',
  createdAt: 1,
  updatedAt: 1,
  environmentMode: 'worktree',
  worktreePath: '/session-worktree',
} as const
const getTree = vi.fn<SessionRepositoryShape['getTree']>()
const readSource = vi.fn(() =>
  Effect.succeed({ status: 'loaded', contents: '<main>Worktree</main>', sizeBytes: 21 } as const),
)

const SessionLayer = Layer.succeed(SessionRepository, {
  ...emptySessionCatalogMethods,
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree,
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: () => Effect.void,
  updateRuntime: () => Effect.void,
  renameBranch: () => Effect.void,
  archiveBranch: () => Effect.void,
  restoreBranch: () => Effect.void,
  updateTreeUiState: () => Effect.void,
  recordActiveRun: () => Effect.void,
  clearActiveRun: () => Effect.void,
  clearInterruptedRuns: () => Effect.void,
  listActiveRunsForRecovery: () => Effect.succeed([]),
  markActiveRunInterrupted: () => Effect.void,
})

const VisualizationLayer = Layer.succeed(InlineVisualizationService, {
  prepareSession: () => Effect.dieMessage('prepareSession is not used'),
  deleteSession: () => Effect.dieMessage('deleteSession is not used'),
  stageSessionDeletion: () => Effect.dieMessage('stageSessionDeletion is not used'),
  readSource,
})

function configureOwnerResponse(response: unknown) {
  configureGuiSessionCommandClient({
    paths: resolveLocalSessionHostPaths({ userDataRoot: '/isolated-gui' }),
    clientVersion: 'test',
  })
  executeConfiguredHostUi.mockResolvedValue(response)
}

function readVisualization() {
  return Effect.runPromise(
    readInlineVisualizationSource({
      sessionId,
      sourcePath: '/session-worktree/.openwaggle/visualizations/map.html',
    }).pipe(Effect.provide(Layer.merge(SessionLayer, VisualizationLayer))),
  )
}

describe('readInlineVisualizationSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeConfiguredHostUi.mockReset()
    getTree.mockReturnValue(
      Effect.succeed({
        session: ownerSession,
        nodes: [],
        branches: [],
        branchStates: [],
        uiState: null,
      }),
    )
  })

  afterEach(() => configureGuiSessionCommandClient(null))

  it('authorizes the effective session worktree without exposing the opened checkout', async () => {
    const sourcePath = '/session-worktree/.openwaggle/visualizations/map.html'

    const result = await Effect.runPromise(
      readInlineVisualizationSource({ sessionId, sourcePath }).pipe(
        Effect.provide(Layer.merge(SessionLayer, VisualizationLayer)),
      ),
    )

    expect(result).toMatchObject({ status: 'loaded' })
    expect(readSource).toHaveBeenCalledWith({
      sessionId,
      sourcePath,
      workspaceRoots: ['/session-worktree'],
      readOnly: false,
    })
  })

  it('reads the authoritative Host owner when the GUI session repository is isolated', async () => {
    configureOwnerResponse(ownerSession)
    getTree.mockReturnValue(Effect.succeed(null))
    const sourcePath = '/session-worktree/.openwaggle/visualizations/map.html'

    const result = await Effect.runPromise(
      readInlineVisualizationSource({ sessionId, sourcePath }).pipe(
        Effect.provide(Layer.merge(SessionLayer, VisualizationLayer)),
      ),
    )

    expect(result).toMatchObject({ status: 'loaded' })
    expect(executeConfiguredHostUi).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'inline-visualization:prepare-source',
        args: [sessionId],
      }),
    )
    expect(getTree).not.toHaveBeenCalled()
    expect(readSource).toHaveBeenCalledWith({
      sessionId,
      sourcePath,
      workspaceRoots: ['/session-worktree'],
      readOnly: true,
    })
  })

  it.each([
    { projectPath: '/opened-checkout', expectedRoots: ['/opened-checkout'] },
    { projectPath: null, expectedRoots: [] },
  ])(
    'preserves local-mode roots for Host project $projectPath',
    async ({ projectPath, expectedRoots }) => {
      configureOwnerResponse({ ...ownerSession, environmentMode: 'local', projectPath })

      await expect(readVisualization()).resolves.toMatchObject({ status: 'loaded' })
      expect(readSource).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoots: expectedRoots }),
      )
    },
  )

  it.each([
    { reason: 'missing', owners: null },
    { reason: 'a different session', owners: { ...ownerSession, id: 'different-session' } },
  ])(
    'does not authorize stale local ownership when the Host returns $reason',
    async ({ owners }) => {
      configureOwnerResponse(owners)

      await expect(readVisualization()).resolves.toEqual({
        status: 'unavailable',
        reason: 'session-missing',
      })
      expect(getTree).not.toHaveBeenCalled()
      expect(readSource).not.toHaveBeenCalled()
    },
  )

  it.each([
    { reason: 'malformed paths', owners: { ...ownerSession, worktreePath: 42 } },
    { reason: 'an invalid environment', owners: { ...ownerSession, environmentMode: 'other' } },
    {
      reason: 'multiple owners',
      owners: [ownerSession, { ...ownerSession, id: 'different-session' }],
    },
  ])('fails closed when the Host returns $reason', async ({ owners }) => {
    configureOwnerResponse(owners)

    await expect(readVisualization()).rejects.toThrow()
    expect(getTree).not.toHaveBeenCalled()
    expect(readSource).not.toHaveBeenCalled()
  })

  it('does not fall back to local ownership after a Host transport failure', async () => {
    configureOwnerResponse(ownerSession)
    executeConfiguredHostUi.mockRejectedValue(new Error('Host disconnected'))

    await expect(readVisualization()).rejects.toThrow()
    expect(getTree).not.toHaveBeenCalled()
    expect(readSource).not.toHaveBeenCalled()
  })

  it('does not fall back to local ownership after the Host is retired for upgrade', async () => {
    retireGuiSessionCommandClientForUpgrade()

    await expect(readVisualization()).rejects.toThrow()
    expect(executeConfiguredHostUi).not.toHaveBeenCalled()
    expect(getTree).not.toHaveBeenCalled()
    expect(readSource).not.toHaveBeenCalled()
  })

  it('rechecks ownership for each source request instead of retaining a deleted Host session', async () => {
    configureOwnerResponse(ownerSession)
    await expect(readVisualization()).resolves.toMatchObject({ status: 'loaded' })
    executeConfiguredHostUi.mockResolvedValue(null)

    await expect(readVisualization()).resolves.toEqual({
      status: 'unavailable',
      reason: 'session-missing',
    })
    expect(executeConfiguredHostUi).toHaveBeenCalledTimes(2)
    expect(readSource).toHaveBeenCalledOnce()
  })
})
