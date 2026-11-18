import * as Layer from 'effect/Layer'
import { ExtensionBuildRunnerLive } from './adapters/extension-build-runner'
import { FilesystemExtensionManagerLive } from './adapters/filesystem-extension-manager-service'
import { FilesystemExtensionPackageRepositoryLive } from './adapters/filesystem-extension-package-repository'
import { SqliteExtensionLifecycleRepositoryLive } from './adapters/sqlite-extension-lifecycle-repository'
import { SqliteExtensionProjectOverridesRepositoryLive } from './adapters/sqlite-extension-project-overrides-repository'
import { AppDatabaseLive } from './services/database-service'

const ExtensionLifecycleRepositoryLive = SqliteExtensionLifecycleRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ExtensionProjectOverridesRepositoryLive = SqliteExtensionProjectOverridesRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)

/** Extension discovery, lifecycle, and project overrides, which decide a Run's extensions. */
export const ExtensionRuntimeSelectionLive = Layer.mergeAll(
  ExtensionLifecycleRepositoryLive,
  ExtensionProjectOverridesRepositoryLive,
  FilesystemExtensionManagerLive,
  FilesystemExtensionPackageRepositoryLive,
  ExtensionBuildRunnerLive,
)
