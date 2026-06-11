import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { ExtensionPackageRepositoryError } from '../errors'
import {
  ExtensionPackageRepository,
  type ExtensionPackageRepositoryShape,
  type RemoveExtensionPackageInput,
  type WriteExtensionPackageInput,
} from '../ports/extension-package-repository'
import { getGlobalExtensionRoot } from './extensions/extension-paths'
import {
  removeFilesystemExtensionPackage,
  writeFilesystemExtensionPackage,
} from './extensions/package-install'

function mapPackageRepositoryError(operation: string, cause: unknown) {
  return new ExtensionPackageRepositoryError({ operation, cause })
}

export function makeFilesystemExtensionPackageRepository(
  globalRootPath: string,
): ExtensionPackageRepositoryShape {
  return ExtensionPackageRepository.of({
    writePackage: (input: WriteExtensionPackageInput) =>
      Effect.tryPromise({
        try: () => writeFilesystemExtensionPackage({ ...input, globalRootPath }),
        catch: (cause) => mapPackageRepositoryError('write-package', cause),
      }),
    removePackage: (input: RemoveExtensionPackageInput) =>
      Effect.tryPromise({
        try: () => removeFilesystemExtensionPackage({ ...input, globalRootPath }),
        catch: (cause) => mapPackageRepositoryError('remove-package', cause),
      }),
  })
}

export const FilesystemExtensionPackageRepositoryLive = Layer.succeed(
  ExtensionPackageRepository,
  makeFilesystemExtensionPackageRepository(getGlobalExtensionRoot(app.getPath('userData'))),
)
