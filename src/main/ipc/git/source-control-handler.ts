import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { sourceControlConfigureRequestSchema } from '@shared/schemas/source-control'
import * as Effect from 'effect/Effect'
import { forgetRemoteRefProbes } from '../../services/source-control/live-resolution-deps'
import {
  configureSourceControl,
  resolveChangeRequestOpenDestination,
} from '../../services/source-control/source-control-configuration'
import { listSourceControlHosts } from '../../services/source-control/source-control-hosts-list'
import { sourceControlSettingsAccess } from '../../services/source-control/source-control-runtime'
import { typedHandle } from '../typed-ipc'
import { invalidateVcsStatus } from './vcs-status-cache'

const MAX_PATH_LENGTH = 4096
const pathSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PATH_LENGTH))
const projectPathArgumentSchema = Schema.NullOr(pathSchema)

/** Settings, the Session Summary, and the inspector read and change source control here. */
export function registerSourceControlHandlers(): void {
  typedHandle('source-control:hosts', () =>
    Effect.promise(() => listSourceControlHosts(sourceControlSettingsAccess())),
  )
  typedHandle('source-control:open-destination', (_event, rawProjectPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathArgumentSchema, rawProjectPath)
      return yield* Effect.promise(() =>
        resolveChangeRequestOpenDestination(projectPath, sourceControlSettingsAccess()),
      )
    }),
  )
  typedHandle('source-control:refresh-status', (_event, rawWorkingPath: unknown) =>
    Effect.sync(() => {
      const workingPath = decodeUnknownOrThrow(pathSchema, rawWorkingPath)
      // After a CLI sign-in the next status must ask the CLI and the remote again.
      forgetRemoteRefProbes()
      invalidateVcsStatus(workingPath)
      return undefined
    }),
  )
  typedHandle('source-control:configure', (_event, rawRequest: unknown) =>
    Effect.gen(function* () {
      const request = decodeUnknownOrThrow(sourceControlConfigureRequestSchema, rawRequest)
      const result = yield* Effect.promise(() =>
        configureSourceControl(request, sourceControlSettingsAccess()),
      )
      // Provider choices and declarations change what every status shows.
      if (result.ok) invalidateVcsStatus()
      return result
    }),
  )
}
