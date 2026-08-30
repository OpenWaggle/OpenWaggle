import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import { loadWithRuntimeFailureIsolation } from '../../extensions/runtime-load-isolation'
import { createLogger } from '../../logger'
import {
  getRuntimeEnabledPackagesPiResourceRoots,
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './openwaggle-pi-runtime-failure-recording'
import { createPiRuntimeServices } from './pi-provider-catalog'
import {
  getPiRuntimeExtensionLoadErrors,
  rejectMatchingOpenWaggleExtensionLoadErrors,
} from './pi-runtime-extension-load-errors'

const logger = createLogger('agent-definition-semantic-catalog')

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export type AgentDefinitionPiProjectServices = Pick<
  AgentSessionServices,
  'modelRuntime' | 'resourceLoader'
>

export async function loadAgentDefinitionPiProjectServices(
  projectPath: string,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
): Promise<AgentDefinitionPiProjectServices> {
  const enabledPackages = await Effect.runPromise(
    listRuntimeEnabledPackages(projectPath, extensionSelectionServices).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Failed to resolve OpenWaggle extension runtime allowlist', {
            projectPath,
            error: message(error),
          })
          return []
        }),
      ),
    ),
  )

  return loadWithRuntimeFailureIsolation({
    selections: enabledPackages,
    load: async (enabledOpenWaggleExtensionPackagePaths) => {
      const services = await createPiRuntimeServices(projectPath, {
        enabledOpenWaggleExtensionPackagePaths,
        enabledOpenWaggleExtensionResourceRoots: getRuntimeEnabledPackagesPiResourceRoots(
          enabledPackages,
          enabledOpenWaggleExtensionPackagePaths,
        ),
      })
      return rejectMatchingOpenWaggleExtensionLoadErrors({
        result: services,
        errors: getPiRuntimeExtensionLoadErrors(services),
        enabledOpenWaggleExtensionPackagePaths,
      })
    },
    recordFailure: (selection, error) =>
      recordRuntimeLoadFailure({
        selection,
        error,
        extensionSelectionServices,
        logger,
        operation: 'Agent definition semantic catalog',
      }),
  })
}
