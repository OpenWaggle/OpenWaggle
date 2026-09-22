import type { ActionInvocation } from '@shared/types/action-definitions'
import type { PreparationPhase, WorkspacePreparation } from '@shared/types/workspace-preparation'
import { enqueueProjectConfigWrite } from '../../config/project-config-write-queue'
import { preparationExecutionKey } from '../../domain/project-action-catalog'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import { PreparationCancellation } from './preparation-cancellation'
import type { PreparationDependencies } from './preparation-dependencies'

export type { PreparationDependencies } from './preparation-dependencies'

import { executeWorkspacePreparation } from './preparation-execution'
import type { StoredWorkspacePreparation } from './preparation-persistence'
import { recoverPreparationAfterHostLoss } from './preparation-recovery'
import {
  capturePreparationSnapshot,
  EMPTY_PREPARATION_EXECUTION,
  preparationProjection,
  requirePreparationRevision,
} from './workspace-preparation-model'

export class ManagedWorkspacePreparation {
  private readonly running = new Set<Promise<WorkspacePreparation>>()
  private readonly cancellation = new PreparationCancellation()
  private readonly live = new Map<string, StoredWorkspacePreparation>()
  constructor(private readonly deps: PreparationDependencies) {}
  private serial<T>(workspaceId: string, operation: () => Promise<T>) {
    return enqueueProjectConfigWrite(`preparation:${workspaceId}`, operation)
  }
  private state(workspaceId: string) {
    return this.live.get(workspaceId) ?? this.deps.persistence.read(workspaceId)
  }
  private async project(workspace: ActionRunWorkspace, state: StoredWorkspacePreparation) {
    try {
      return preparationProjection(state, await this.deps.catalog(workspace))
    } catch (error) {
      // Current definitions only inform update availability. Execution uses the reviewed snapshot.
      return preparationProjection(
        state,
        null,
        error instanceof Error ? error.message : 'Could not read current preparation definitions.',
      )
    }
  }
  private async save(state: StoredWorkspacePreparation, previousRevision: number) {
    await this.deps.persistence.write(state, previousRevision)
    this.live.delete(state.workspaceId)
    return state
  }
  async read(workspace: ActionRunWorkspace) {
    const state = await this.state(workspace.workspaceId)
    return state ? this.project(workspace, state) : null
  }
  capture(workspace: ActionRunWorkspace, profileId?: string) {
    return this.serial(workspace.workspaceId, async () => {
      const existing = await this.state(workspace.workspaceId)
      if (existing) return this.project(workspace, existing)
      const snapshot = capturePreparationSnapshot(await this.deps.catalog(workspace), profileId)
      const state = await this.save(
        {
          workspaceId: workspace.workspaceId,
          revision: 1,
          snapshot,
          setup: EMPTY_PREPARATION_EXECUTION,
          cleanup: EMPTY_PREPARATION_EXECUTION,
          environment: {},
        },
        0,
      )
      return this.project(workspace, state)
    })
  }
  async prepareBirth(workspace: ActionRunWorkspace) {
    await this.capture(workspace)
    return this.serial(workspace.workspaceId, async () => {
      const state = await this.requireState(workspace.workspaceId)
      if (state.setup.status === 'idle' && state.cleanup.status === 'idle')
        return this.project(workspace, state)
      return this.project(
        workspace,
        await this.save(
          {
            ...state,
            revision: state.revision + 1,
            setup: EMPTY_PREPARATION_EXECUTION,
            cleanup: EMPTY_PREPARATION_EXECUTION,
            environment: {},
          },
          state.revision,
        ),
      )
    })
  }
  async stopSetup(workspace: ActionRunWorkspace, attemptId: string) {
    await this.cancellation.stopSetup(workspace.workspaceId, attemptId)
    return this.project(workspace, await this.requireState(workspace.workspaceId))
  }
  select(workspace: ActionRunWorkspace, profileId: string, expectedRevision: number) {
    return this.serial(workspace.workspaceId, async () => {
      const previous = await this.state(workspace.workspaceId)
      requirePreparationRevision(previous, expectedRevision)
      if (previous && (previous.setup.status !== 'idle' || previous.cleanup.status !== 'idle'))
        throw new Error(
          'Preparation has already started. Adopt an updated snapshot explicitly instead.',
        )
      const snapshot = capturePreparationSnapshot(await this.deps.catalog(workspace), profileId)
      return this.project(
        workspace,
        await this.save(
          {
            workspaceId: workspace.workspaceId,
            revision: expectedRevision + 1,
            snapshot,
            setup: EMPTY_PREPARATION_EXECUTION,
            cleanup: EMPTY_PREPARATION_EXECUTION,
            environment: {},
          },
          expectedRevision,
        ),
      )
    })
  }
  adopt(workspace: ActionRunWorkspace, expectedRevision: number) {
    return this.serial(workspace.workspaceId, async () => {
      const previous = await this.requireState(workspace.workspaceId, expectedRevision)
      const snapshot = capturePreparationSnapshot(
        await this.deps.catalog(workspace),
        previous.snapshot.profile.id,
      )
      return this.project(
        workspace,
        await this.save(
          {
            ...previous,
            revision: previous.revision + 1,
            snapshot,
            setup: EMPTY_PREPARATION_EXECUTION,
            cleanup: EMPTY_PREPARATION_EXECUTION,
            environment: {},
          },
          previous.revision,
        ),
      )
    })
  }
  private async requireState(workspaceId: string, revision?: number) {
    const state = await this.state(workspaceId)
    if (!state) throw new Error('Choose a Preparation profile first.')
    if (revision !== undefined) requirePreparationRevision(state, revision)
    return state
  }
  review(
    workspace: ActionRunWorkspace,
    definitionId: string,
    enabled: boolean,
    expectedRevision: number,
  ) {
    return this.serial(workspace.workspaceId, async () => {
      const state = await this.requireState(workspace.workspaceId, expectedRevision)
      const entry = state.snapshot.definitions.find(
        ({ definition }) => definition.id === definitionId,
      )
      if (!entry) throw new Error('This definition is not part of the Workspace snapshot.')
      const definition = entry.definition
      await this.deps.rememberReview?.(workspace, definition, enabled)
      const definitions = state.snapshot.definitions.map((value) =>
        value === entry
          ? {
              ...entry,
              review: enabled ? ('enabled' as const) : ('disabled' as const),
              previous: {
                definitionId,
                enabled,
                invocation: definition.invocation,
                fingerprint: preparationExecutionKey(definition),
              },
            }
          : value,
      )
      return this.project(
        workspace,
        await this.save(
          { ...state, revision: state.revision + 1, snapshot: { ...state.snapshot, definitions } },
          state.revision,
        ),
      )
    })
  }
  skip(workspace: ActionRunWorkspace, phase: PreparationPhase, expectedRevision: number) {
    return this.serial(workspace.workspaceId, async () => {
      const state = await this.requireState(workspace.workspaceId, expectedRevision)
      return this.project(
        workspace,
        await this.save(
          {
            ...state,
            revision: state.revision + 1,
            [phase]: { ...state[phase], status: 'skipped', finishedAt: Date.now(), error: null },
          },
          state.revision,
        ),
      )
    })
  }
  run(
    workspace: ActionRunWorkspace,
    phase: PreparationPhase,
    expectedRevision?: number,
    onStarted?: (state: WorkspacePreparation) => void,
  ) {
    const pending = this.serial(workspace.workspaceId, async () => {
      const state = await this.requireState(workspace.workspaceId, expectedRevision)
      if (
        expectedRevision === undefined &&
        (state[phase].status === 'succeeded' || state[phase].status === 'skipped')
      )
        return this.project(workspace, state)
      const entry = state.snapshot.definitions.find(({ definition }) => definition.phase === phase)
      if (entry?.review !== 'enabled') {
        const status = entry?.review === 'required' ? 'review-required' : 'skipped'
        return this.project(
          workspace,
          await this.save(
            {
              ...state,
              revision: state.revision + 1,
              [phase]: {
                ...EMPTY_PREPARATION_EXECUTION,
                status,
                error:
                  status === 'review-required'
                    ? 'Review this Workspace’s preparation snapshot before execution.'
                    : null,
              },
            },
            state.revision,
          ),
        )
      }
      return this.execute(workspace, state, phase, entry.definition.invocation, onStarted)
    })
    this.running.add(pending)
    void pending.finally(() => this.running.delete(pending)).catch(() => {})
    return pending
  }
  private async execute(
    workspace: ActionRunWorkspace,
    previous: StoredWorkspacePreparation,
    phase: PreparationPhase,
    invocation: ActionInvocation,
    onStarted?: (state: WorkspacePreparation) => void,
  ) {
    const cancellation = this.cancellation.begin(workspace.workspaceId, phase)
    try {
      const state = await executeWorkspacePreparation({
        workspace,
        previous,
        phase,
        invocation,
        deps: this.deps,
        signal: cancellation.signal,
        onStarted: async (state) => {
          cancellation.started(state[phase].attemptId)
          onStarted?.(await this.project(workspace, state))
        },
        publish: (state) => {
          if (state) this.live.set(workspace.workspaceId, state)
          else this.live.delete(workspace.workspaceId)
        },
      })
      return this.project(workspace, state)
    } finally {
      cancellation.finish()
    }
  }
  async requireSetup(workspace: ActionRunWorkspace) {
    let state = await this.read(workspace)
    if (!state) return
    if (state.setup.status === 'idle' || state.setup.status === 'running')
      state = await this.run(workspace, 'setup')
    if (state.setup.status !== 'succeeded' && state.setup.status !== 'skipped')
      throw new Error(
        `Workspace setup is ${state.setup.status}. Open Workspace preparation to retry, review, or Continue anyway.`,
      )
  }
  async environment(workspaceId: string) {
    return (await this.state(workspaceId))?.environment ?? {}
  }
  async waitForRuns() {
    await Promise.allSettled([...this.running])
  }
  recoverAfterHostLoss() {
    return recoverPreparationAfterHostLoss(this.deps.persistence)
  }
}
