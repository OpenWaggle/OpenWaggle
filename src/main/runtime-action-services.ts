import * as Layer from 'effect/Layer'
import { WorkspaceExecutionAdmissionLive } from './adapters/project-actions/action-workspace-admission'
import { HostActionRunServiceLive } from './adapters/project-actions/host-action-run-service'
import { HostWorkspacePreparationServiceLive } from './adapters/project-actions/host-workspace-preparation-service'
import { SqliteActionCatalogServiceLive } from './adapters/project-actions/sqlite-action-catalog'
import { SqliteSessionProjectionRepositoryLive } from './adapters/sqlite-session-projection-repository'
import { SqliteSessionWorkspaceResourceRepositoryLive } from './adapters/sqlite-session-workspace-resource-repository'
import { AppDatabaseLive } from './services/database-service'

const ActionCatalogLive = SqliteActionCatalogServiceLive.pipe(Layer.provide(AppDatabaseLive))
const AdmissionLive = WorkspaceExecutionAdmissionLive.pipe(Layer.provide(AppDatabaseLive))
const PreparationLive = HostWorkspacePreparationServiceLive.pipe(
  Layer.provide(Layer.mergeAll(AppDatabaseLive, ActionCatalogLive, AdmissionLive)),
)
const ActionRunsLive = HostActionRunServiceLive.pipe(
  Layer.provide(Layer.mergeAll(AppDatabaseLive, ActionCatalogLive, PreparationLive, AdmissionLive)),
)

export const ActionServicesLive = Layer.mergeAll(ActionCatalogLive, ActionRunsLive, PreparationLive)

export const ActionKernelServicesLive = Layer.mergeAll(
  ActionServicesLive,
  SqliteSessionWorkspaceResourceRepositoryLive.pipe(Layer.provide(AppDatabaseLive)),
)

export const SessionProjectionWithActionsLive = SqliteSessionProjectionRepositoryLive.pipe(
  Layer.provide(ActionKernelServicesLive),
)
