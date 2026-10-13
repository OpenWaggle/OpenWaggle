import * as Effect from 'effect/Effect'
import { loadWithRuntimeFailureIsolation } from '../../extensions/runtime-load-isolation'
import { createLogger } from '../../logger'
import {
  getRuntimeEnabledPackagesPiResourceRoots,
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './openwaggle-pi-runtime-failure-recording'
import type { PiExtensionLoadErrorRecord } from './pi-provider-catalog-types'
import type { PiRuntimeServicesOptions } from './pi-provider-resources'
import { rejectMatchingOpenWaggleExtensionLoadErrors } from './pi-runtime-extension-load-errors'

const logger = createLogger('pi-project-runtime-load')

type ProjectExtensionOptions = Required<
  Pick<
    PiRuntimeServicesOptions,
    'enabledOpenWaggleExtensionPackagePaths' | 'enabledOpenWaggleExtensionResourceRoots'
  >
>

/**
 * Loads something built from a project's Pi runtime with the OpenWaggle extensions that project
 * runs, as Runs do: an extension that fails to load is turned off and the load retried without it.
 */
export function loadWithProjectExtensions<Result>(input: {
  readonly projectPath: string | null | undefined
  readonly extensionSelectionServices: OpenWagglePiExtensionSelectionServices
  readonly operation: string
  readonly load: (options: ProjectExtensionOptions) => Promise<Result>
  readonly loadErrors: (result: Result) => readonly PiExtensionLoadErrorRecord[]
}) {
  return Effect.gen(function* () {
    const { projectPath, extensionSelectionServices } = input
    const enabledPackages = projectPath
      ? yield* listRuntimeEnabledPackages(projectPath, extensionSelectionServices).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              logger.warn('Failed to resolve OpenWaggle extension runtime allowlist', {
                projectPath,
                error: error instanceof Error ? error.message : String(error),
              })
              return []
            }),
          ),
        )
      : []

    return yield* Effect.promise(() =>
      loadWithRuntimeFailureIsolation({
        selections: enabledPackages,
        load: async (enabledOpenWaggleExtensionPackagePaths) => {
          const result = await input.load({
            enabledOpenWaggleExtensionPackagePaths,
            enabledOpenWaggleExtensionResourceRoots: getRuntimeEnabledPackagesPiResourceRoots(
              enabledPackages,
              enabledOpenWaggleExtensionPackagePaths,
            ),
          })
          return rejectMatchingOpenWaggleExtensionLoadErrors({
            result,
            errors: input.loadErrors(result),
            enabledOpenWaggleExtensionPackagePaths,
          })
        },
        recordFailure: (selection, error) =>
          recordRuntimeLoadFailure({
            selection,
            error,
            extensionSelectionServices,
            logger,
            operation: input.operation,
          }),
      }),
    )
  })
}
