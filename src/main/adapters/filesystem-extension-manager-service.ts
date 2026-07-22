import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Effect, Layer } from 'effect'
import { app } from 'electron'
import { ExtensionDiscoveryError } from '../errors'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { discoverExtensionPackages } from './extensions/discovery'
import { getGlobalExtensionRoot } from './extensions/extension-paths'

export const FilesystemExtensionManagerLive = Layer.succeed(
  ExtensionManagerService,
  ExtensionManagerService.of({
    listPackages: (input) =>
      Effect.tryPromise({
        try: () =>
          discoverExtensionPackages({
            projectPath: input.projectPath,
            globalRootPath: getGlobalExtensionRoot(app.getPath('userData')),
            hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
          }),
        catch: (cause) => new ExtensionDiscoveryError({ operation: 'list-packages', cause }),
      }),
  }),
)
