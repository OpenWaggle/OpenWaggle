import type { DocsDiscoveryView, DocsListInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import { listDocsDiscoveryView } from '../../application/docs-discovery-service'
import { createLogger } from '../../logger'
import { DocsBundleService, type DocsBundleServiceShape } from '../../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import type { OpenWaggleDocsToolServices } from './openwaggle-docs-tool-extension'
import {
  listRuntimeEnabledPackagePaths,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'

const logger = createLogger('openwaggle-docs-tool')
/** A missing bundle is reported once per process rather than on every Run. */
let reportedUnavailableBundle = false

/**
 * Package paths of the extensions a Run in `projectPaths` loads: trusted, enabled, reloaded, and
 * not disabled for the project. When they cannot be listed, no extension docs are offered.
 */
function runtimeEnabledPackagePaths(
  projectPaths: readonly string[],
  extensionSelection: OpenWagglePiExtensionSelectionServices,
) {
  return Effect.forEach(projectPaths, (projectPath) =>
    listRuntimeEnabledPackagePaths(projectPath, extensionSelection).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Enabled extensions could not be listed for agent docs', {
            projectPath,
            error: error instanceof Error ? error.message : String(error),
          })
          return []
        }),
      ),
    ),
  ).pipe(Effect.map((paths) => new Set(paths.flat())))
}

/** The view with extension docs only from extensions the Run would load. */
function withRuntimeEnabledExtensionDocs(
  view: DocsDiscoveryView,
  input: DocsListInput,
  extensionSelection: OpenWagglePiExtensionSelectionServices,
) {
  if (view.extensionTopics.length === 0) return Effect.succeed(view)
  return runtimeEnabledPackagePaths(input.projectPaths ?? [], extensionSelection).pipe(
    Effect.map((enabled) => ({
      ...view,
      extensionTopics: view.extensionTopics.filter((topic) =>
        enabled.has(topic.provenance.packagePath),
      ),
    })),
  )
}

/** The `openwaggle_docs` tool's view of the same docs discovery the renderer and extensions use. */
export function createOpenWaggleDocsToolServices(dependencies: {
  readonly docsBundle: DocsBundleServiceShape
  readonly extensionSelection: OpenWagglePiExtensionSelectionServices
}): OpenWaggleDocsToolServices {
  const { docsBundle, extensionSelection } = dependencies
  return {
    bundlePath: () => docsBundle.getBundlePath(),
    availableBundlePath: () =>
      docsBundle.loadBundle().pipe(
        Effect.map((bundle): string | null => bundle.bundlePath),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            if (reportedUnavailableBundle) return null
            reportedUnavailableBundle = true
            const bundlePath = yield* docsBundle.getBundlePath()
            logger.warn('The installed OpenWaggle docs bundle is unavailable for agent Runs', {
              bundlePath,
              cause: String(cause),
            })
            return null
          }),
        ),
      ),
    discover: (input) =>
      listDocsDiscoveryView(input).pipe(
        Effect.provideService(DocsBundleService, docsBundle),
        Effect.provideService(ExtensionManagerService, extensionSelection.manager),
        Effect.provideService(ExtensionLifecycleRepository, extensionSelection.lifecycleRepository),
        Effect.flatMap((view) => withRuntimeEnabledExtensionDocs(view, input, extensionSelection)),
      ),
  }
}
