import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import {
  type OpenWagglePiExtensionSelectionServices,
  type RuntimeEnabledOpenWaggleExtensionPackage,
  upsertRuntimeLoadFailure,
} from './openwaggle-pi-extension-selection'

interface RuntimeLoadFailureLogger {
  readonly warn: (
    message: string,
    context: {
      readonly extensionId: string
      readonly packagePath: string
      readonly error: string
    },
  ) => void
}

export async function recordRuntimeLoadFailure(input: {
  readonly selection: RuntimeEnabledOpenWaggleExtensionPackage
  readonly error: unknown
  readonly extensionSelectionServices: OpenWagglePiExtensionSelectionServices
  readonly logger: RuntimeLoadFailureLogger
  readonly operation: string
}) {
  input.logger.warn(`Disabled OpenWaggle extension after ${input.operation} load failure`, {
    extensionId: input.selection.extensionPackage.id,
    packagePath: input.selection.packagePath,
    error: formatErrorMessage(input.error),
  })

  await Effect.runPromise(
    upsertRuntimeLoadFailure(input.selection, input.error, input.extensionSelectionServices),
  ).catch((repositoryError) => {
    input.logger.warn('Failed to persist OpenWaggle extension runtime load failure', {
      extensionId: input.selection.extensionPackage.id,
      packagePath: input.selection.packagePath,
      error: formatErrorMessage(repositoryError),
    })
  })
}
