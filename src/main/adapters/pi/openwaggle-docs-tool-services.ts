import * as Effect from 'effect/Effect'
import { listDocsDiscoveryView } from '../../application/docs-discovery-service'
import { createLogger } from '../../logger'
import { DocsBundleService, type DocsBundleServiceShape } from '../../ports/docs-bundle-service'
import {
  ExtensionLifecycleRepository,
  type ExtensionLifecycleRepositoryShape,
} from '../../ports/extension-lifecycle-repository'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../../ports/extension-manager-service'
import type { OpenWaggleDocsToolServices } from './openwaggle-docs-tool-extension'

const logger = createLogger('openwaggle-docs-tool')
/** A missing bundle is reported once per process rather than on every Run. */
let reportedUnavailableBundle = false

/** The `openwaggle_docs` tool's view of the same docs discovery the renderer and extensions use. */
export function createOpenWaggleDocsToolServices(dependencies: {
  readonly docsBundle: DocsBundleServiceShape
  readonly extensionManager: ExtensionManagerServiceShape
  readonly extensionLifecycle: ExtensionLifecycleRepositoryShape
}): OpenWaggleDocsToolServices {
  return {
    bundlePath: () => dependencies.docsBundle.getBundlePath(),
    availableBundlePath: () =>
      dependencies.docsBundle.loadBundle().pipe(
        Effect.map((bundle): string | null => bundle.bundlePath),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            if (reportedUnavailableBundle) return null
            reportedUnavailableBundle = true
            const bundlePath = yield* dependencies.docsBundle.getBundlePath()
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
        Effect.provideService(DocsBundleService, dependencies.docsBundle),
        Effect.provideService(ExtensionManagerService, dependencies.extensionManager),
        Effect.provideService(ExtensionLifecycleRepository, dependencies.extensionLifecycle),
      ),
  }
}
