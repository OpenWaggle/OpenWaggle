import * as Layer from 'effect/Layer'
import { SqliteHiveWorkerCleanupRepositoryLive } from './adapters/sqlite-hive-worker-cleanup-repository'
import { SqliteSessionOrganizationRepositoryLive } from './adapters/sqlite-session-organization-repository'
import { HiveWorkerCleanupLive } from './application/hive-worker-cleanup-service'
import { ActionKernelServicesLive } from './runtime-action-services'
import { DesktopServicesLive } from './runtime-desktop-services'
import { AppDatabaseLive } from './services/database-service'

/** Host Hive cleanup phase: archive finished Workers the user never interacted with. */
export const HiveWorkerCleanupServicesLive = HiveWorkerCleanupLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mergeAll(
        SqliteHiveWorkerCleanupRepositoryLive,
        SqliteSessionOrganizationRepositoryLive,
      ).pipe(Layer.provide(AppDatabaseLive)),
      ActionKernelServicesLive,
      DesktopServicesLive,
    ),
  ),
)
