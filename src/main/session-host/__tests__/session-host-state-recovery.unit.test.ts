import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect, it, vi } from 'vitest'
import type { StoredWorkspacePreparation } from '../../adapters/project-actions/preparation-persistence'
import { recoverPreparationAfterHostLoss } from '../../adapters/project-actions/preparation-recovery'
import { prepareWorkspaceRemoval } from '../../application/workspace-cleanup'
import { ActionRunService } from '../../ports/action-run-service'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SessionHostRecoveryRepository } from '../../ports/session-host-recovery-repository'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SessionWorkspaceHandoffService } from '../../ports/session-workspace-handoff-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { TerminalService } from '../../ports/terminal-service'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { recoverHostState } from '../session-host-state-recovery'

vi.mock('../../application/agent-run-service', () => ({
  reconcileInterruptedAgentRuns: () => Effect.void,
}))
vi.mock('../../application/host-ui-worktree-operation', () => ({
  recoverPendingManagedWorktreeRemovals: () => Effect.succeed([]),
}))
vi.mock('../../application/session-export-recovery', () => ({
  recoverSessionExportsAfterHostLoss: () => Effect.void,
}))
vi.mock('../../application/session-organization-service', () => ({
  recoverPendingSessionHandoffs: () => Effect.succeed([]),
}))

// Unrelated recovery stages above are mocked; keep their declared port requirements typed.
const unrelatedRecoveryServices = Layer.mergeAll(
  Layer.succeed(AgentKernelService, fromPartial({})),
  Layer.succeed(DesktopServiceBroker, fromPartial({})),
  Layer.succeed(ExtensionLifecycleRepository, fromPartial({})),
  Layer.succeed(ExtensionManagerService, fromPartial({})),
  Layer.succeed(ExtensionProjectOverridesRepository, fromPartial({})),
  Layer.succeed(SessionExportOperationRepository, fromPartial({})),
  Layer.succeed(SessionOrganizationRepository, fromPartial({})),
  Layer.succeed(SessionRepository, fromPartial({})),
  Layer.succeed(SessionWorkspaceHandoffService, fromPartial({})),
  Layer.succeed(SessionWorkspaceResourceRepository, fromPartial({})),
  Layer.succeed(TerminalService, fromPartial({})),
)

it('interrupts crashed cleanup before resuming a journaled Session deletion', async () => {
  const workspace = { workspaceId: 'workspace', projectPath: '/repo', workspacePath: '/worktree' }
  let stored = fromPartial<StoredWorkspacePreparation>({
    workspaceId: workspace.workspaceId,
    revision: 1,
    setup: { status: 'succeeded' },
    cleanup: { status: 'running', output: 'side effect already started', attemptId: 'old-attempt' },
  })
  const run = vi.fn(() => Effect.succeed(fromPartial<WorkspacePreparation>(stored)))
  const order: string[] = []
  const preparation = WorkspacePreparationService.of(
    fromPartial({
      read: () => Effect.succeed(fromPartial<WorkspacePreparation>(stored)),
      isCurrentWorkspaceGeneration: () => Effect.succeed(true),
      run,
      recoverAfterHostLoss: Effect.promise(async () => {
        order.push('interrupt-preparation')
        await recoverPreparationAfterHostLoss({
          read: async () => stored,
          list: async () => [stored],
          write: async (state) => {
            stored = state
          },
        })
      }),
    }),
  )
  const cleanup = prepareWorkspaceRemoval(workspace, { retryFailed: false }).pipe(
    Effect.provideService(WorkspacePreparationService, preparation),
    Effect.provideService(ActionRunService, fromPartial({ stopWorkspaceRuns: () => Effect.void })),
  )
  let retained: WorkspacePreparation | undefined
  await Effect.runPromise(
    recoverHostState().pipe(
      Effect.provide(unrelatedRecoveryServices),
      Effect.provideService(WorkspacePreparationService, preparation),
      Effect.provideService(
        ActionRunService,
        fromPartial({
          recoverAfterHostLoss: Effect.sync(() => {
            order.push('interrupt-actions')
          }),
        }),
      ),
      Effect.provideService(
        SessionHostRecoveryRepository,
        fromPartial({
          recoverAfterHostLoss: () =>
            Effect.succeed(fromPartial({ pendingWorktreeRemovals: [], pendingHandoffs: [] })),
        }),
      ),
      Effect.provideService(
        SessionProjectionRepository,
        fromPartial({
          recoverPendingDeletions: () =>
            Effect.gen(function* () {
              order.push('recover-deletion')
              const result = yield* cleanup
              if (result && !result.ok) retained = result.preparation
            }),
        }),
      ),
      Effect.provideService(
        SessionLifecyclePreparationService,
        fromPartial({ recoverPending: Effect.void }),
      ),
    ),
  )
  expect(run).not.toHaveBeenCalled()
  expect(retained?.cleanup).toMatchObject({
    status: 'failed',
    output: 'side effect already started',
    attemptId: 'old-attempt',
    error: expect.stringContaining('Retry explicitly'),
  })
  expect(order).toEqual(['interrupt-preparation', 'interrupt-actions', 'recover-deletion'])
})
