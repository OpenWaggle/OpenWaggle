import type { PreparationPhase, WorkspacePreparation } from '@shared/types/workspace-preparation'
import { Context, type Effect } from 'effect'
import type { ActionRunWorkspace } from './action-run-service'

export interface WorkspacePreparationServiceShape {
  readonly capture: (
    workspace: ActionRunWorkspace,
    profileId?: string,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly read: (
    workspace: ActionRunWorkspace,
  ) => Effect.Effect<WorkspacePreparation | null, Error>
  readonly select: (
    workspace: ActionRunWorkspace,
    profileId: string,
    expectedRevision: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly adopt: (
    workspace: ActionRunWorkspace,
    expectedRevision: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly run: (
    workspace: ActionRunWorkspace,
    phase: PreparationPhase,
    expectedRevision?: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly startSetup: (
    workspace: ActionRunWorkspace,
    expectedRevision: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly skip: (
    workspace: ActionRunWorkspace,
    phase: PreparationPhase,
    expectedRevision: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly review: (
    workspace: ActionRunWorkspace,
    definitionId: string,
    enabled: boolean,
    expectedRevision: number,
  ) => Effect.Effect<WorkspacePreparation, Error>
  readonly requireSetup: (workspace: ActionRunWorkspace) => Effect.Effect<void, Error>
  readonly environment: (
    workspaceId: string,
  ) => Effect.Effect<Readonly<Record<string, string>>, Error>
  readonly recoverAfterHostLoss: Effect.Effect<void, Error>
}
export class WorkspacePreparationService extends Context.Tag(
  '@openwaggle/WorkspacePreparationService',
)<WorkspacePreparationService, WorkspacePreparationServiceShape>() {}
